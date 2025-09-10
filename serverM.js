// serverM.js
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const bcrypt = require('bcryptjs'); // bcryptjs avoids native build issues in many environments

const app = express();
const PORT = process.env.PORT || 3002;

// CORS: allow only your frontend in production; default '*' for dev
const FRONTEND_URL = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: FRONTEND_URL }));
app.use(bodyParser.json());

// DB file
const DB_FILE = path.join(__dirname, 'db.json');

// ---------- Helpers ----------
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextUserId(users) {
  const ids = users.map(u => (typeof u.id === 'number' ? u.id : 0));
  const max = ids.length ? Math.max(...ids) : 0;
  return max + 1;
}

function isBcryptHash(str) {
  return typeof str === 'string' && str.startsWith('$2');
}

// ---------- Mailer (uses env vars) ----------
let transporter = null;

if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for 587
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
} else {
  console.warn('⚠️ SMTP not configured. Emails will NOT be sent. Set SMTP_USER and SMTP_PASS for email capability.');
}

// ---------- Routes ----------

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Manager API is running' });
});

// Get all users
app.get('/users', (req, res) => {
  try {
    const data = readDB();
    res.json(data.users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// Get single user by id
app.get('/users/:id', (req, res) => {
  try {
    const data = readDB();
    const user = data.users.find(u => String(u.id) === String(req.params.id));
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch user' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const data = readDB();
    const user = data.users.find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
    if (!user) return res.status(400).json({ success: false, message: 'User not found' });

    if (isBcryptHash(user.password)) {
      const match = await bcrypt.compare(password, user.password);
      if (!match) return res.status(400).json({ success: false, message: 'Incorrect password' });
      return res.json({ success: true, user, message: 'Login successful!' });
    }

    // legacy plaintext password -> upgrade to hashed
    if (password === user.password) {
      user.password = await bcrypt.hash(password, 10);
      writeDB(data);
      return res.json({ success: true, user, message: 'Login successful!' });
    }

    return res.status(400).json({ success: false, message: 'Incorrect password' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// Register
app.post('/users', async (req, res) => {
  const { name, email, password, phone } = req.body;
  try {
    const data = readDB();
    const exists = data.users.find(u => (u.email || '').toLowerCase() === (email || '').toLowerCase());
    if (exists) return res.status(400).json({ success: false, message: 'Email already registered' });

    const id = nextUserId(data.users);
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = { id, name, email, password: hashedPassword, phone, createdAt: new Date().toISOString() };
    data.users.push(user);
    writeDB(data);

    // send welcome email if transporter configured, but do not fail registration if email fails
    if (transporter) {
      const mailOptions = {
        from: process.env.EMAIL_FROM || `"Loan App" <${process.env.SMTP_USER}>`,
        to: email,
        subject: '🎉 Welcome to Loan App!',
        html: `<h2>Hi ${name},</h2>
          <p>Thank you for registering with <b>Loan App</b>.</p>
          <br/><p>Regards,<br/>Loan App Team</p>`
      };
      try {
        await transporter.sendMail(mailOptions);
      } catch (err) {
        console.error('⚠️ Failed to send welcome email:', err.message);
      }
    } else {
      console.log('ℹ️ Skipping welcome email because transporter is not configured.');
    }

    res.json({ success: true, message: 'Registration successful! Please login.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// Notify borrower about loan status (sent by manager)
app.post('/notify-loan-status', async (req, res) => {
  try {
    const { email, name, loanId, status } = req.body;
    if (!email || !loanId || !status) {
      return res.status(400).json({ success: false, message: 'email, loanId and status are required' });
    }

    if (!transporter) {
      return res.status(500).json({ success: false, message: 'SMTP not configured on server' });
    }

    const subject = `Loan #${loanId} ${status}`;
    const html =
      `<h2>Hi ${name || 'there'},</h2>
       <p>Your loan application <b>#${loanId}</b> has been <b>${status}</b>.</p>
       <br/><p>Regards,<br/>Loan App Team</p>`;

    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `"Loan App" <${process.env.SMTP_USER}>`,
      to: email,
      subject,
      html
    });

    res.json({ success: true, message: 'Notification email sent' });
  } catch (err) {
    console.error('❌ notify-loan-status failed:', err);
    res.status(500).json({ success: false, message: 'Failed to send notification' });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`🚀 Manager API running at http://localhost:${PORT}`);
});

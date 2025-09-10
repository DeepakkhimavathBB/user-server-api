const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const bcrypt = require('bcrypt');

const app = express();
const PORT = 3002;

app.use(cors());
app.use(bodyParser.json());

const DB_FILE = path.join(__dirname, 'db.json');

// ---------- Helpers ----------
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function nextUserId(users) {
  const ids = users.map(u => typeof u.id === 'number' ? u.id : 0);
  const max = ids.length ? Math.max(...ids) : 0;
  return max + 1;
}

function isBcryptHash(str) {
  return typeof str === 'string' && str.startsWith('$2');
}

// ---------- Mailer ----------
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: 'deepakkhimavath@gmail.com',
    pass: 'grnz atiu ujqk gsti' // Gmail App Password
  }
});

// ---------- Users ----------
app.get('/users', (req, res) => {
  try {
    const data = readDB();
    res.json(data.users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch users' });
  }
});

// NEW: fetch single user by id (needed by manager to get email)
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
// Health
app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Manager API is running' });
  });
  
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

    const mailOptions = {
      from: '"Loan App 🚀" <deepakkhimavath@gmail.com>',
      to: email,
      subject: '🎉 Welcome to Loan App!',
      html: `<h2>Hi ${name},</h2>
             <p>Thank you for registering with <b>Loan App</b>.</p>
             <p>You can now login and explore our services.</p>
             <br/><p>Regards,<br/>Loan App Team</p>`
    };
    await transporter.sendMail(mailOptions);

    res.json({ success: true, message: 'Registration successful! Please login.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

// ---------- Notifications (email only) ----------
// NEW: manager calls this after status change to notify borrower
app.post('/notify-loan-status', async (req, res) => {
  try {
    const { email, name, loanId, status } = req.body;

    if (!email || !loanId || !status) {
      return res.status(400).json({ success: false, message: 'email, loanId and status are required' });
    }

    const subject = `Loan #${loanId} ${status}`;
    const html =
      `<h2>Hi ${name || 'there'},</h2>
       <p>Your loan application <b>#${loanId}</b> has been <b>${status}</b>.</p>
       ${status === 'Approved'
          ? '<p>🎉 Congratulations! Our team will contact you soon.</p>'
          : status === 'Rejected'
            ? '<p>We’re sorry to inform you it was not approved at this time. You may re-apply later.</p>'
            : '<p>Status updated.</p>'}
       <br/><p>Regards,<br/>Loan App Team</p>`;

    await transporter.sendMail({
      from: '"Loan App 🚀" <deepakkhimavath@gmail.com>',
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

// ---------- Start ----------
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
});

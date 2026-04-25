require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const PDFDocument = require('pdfkit');
const mammoth = require('mammoth');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Email setup
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

app.use(cors());
app.use(express.json());
app.use('/converted', express.static('converted'));

['uploads', 'converted'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

const DAILY_LIMIT = 20;
const JWT_SECRET = process.env.JWT_SECRET || 'ConvertX2024Secret';

// Auth middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Login required' });
    const decoded = jwt.verify(token, JWT_SECRET);
    const { data: user } = await supabase.from('users').select('*').eq('id', decoded.userId).single();
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please login again' });
  }
};

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, otp) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'ConvertX <noreply@convertx.com>',
    to: email,
    subject: 'ConvertX - Your Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 30px; background: #f9fafb;">
        <div style="background: white; padding: 30px; border-radius: 10px; text-align: center;">
          <h1 style="color: #4A90E2;">📄 ConvertX</h1>
          <h2>Verify Your Email</h2>
          <p style="color: #666;">Use this code to download your converted file:</p>
          <div style="background: #EBF3FC; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; color: #4A90E2; letter-spacing: 8px;">${otp}</span>
          </div>
          <p style="color: #999; font-size: 14px;">This code expires in 10 minutes.</p>
        </div>
      </div>
    `
  });
}

async function checkDailyLimit(email) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from('converted_files')
    .select('*', { count: 'exact', head: true })
    .eq('user_email', email)
    .gte('converted_at', today.toISOString());
  return count || 0;
}

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy', service: 'ConvertX API', time: new Date().toISOString() });
});

// ═══════════════════════════════════════
// CONVERT FILE
// ═══════════════════════════════════════
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const outputFilename = uuidv4() + '.pdf';
    const outputPath = path.join('converted', outputFilename);
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    console.log('Converting:', req.file.originalname);

    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      const image = sharp(req.file.path);
      const metadata = await image.metadata();
      const doc = new PDFDocument({ size: [metadata.width || 612, metadata.height || 792], margin: 0 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.image(req.file.path, 0, 0, { fit: [doc.page.width, doc.page.height], align: 'center', valign: 'center' });
      doc.end();
      await new Promise(resolve => stream.on('finish', resolve));
    } else if (['.docx', '.doc'].includes(ext)) {
      const result = await mammoth.extractRawText({ path: req.file.path });
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(12).font('Helvetica');
      result.value.split('\n\n').forEach((para, i) => {
        if (para.trim()) {
          if (i > 0) doc.moveDown(0.5);
          doc.text(para.trim(), { lineGap: 4 });
        }
      });
      doc.end();
      await new Promise(resolve => stream.on('finish', resolve));
    } else {
      let content = ['.txt', '.html', '.htm'].includes(ext) 
        ? fs.readFileSync(req.file.path, 'utf8').replace(/<[^>]*>/g, '')
        : `File: ${req.file.originalname}\n\nConverted by ConvertX`;
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(12).font('Helvetica').text(content, { lineGap: 4 });
      doc.end();
      await new Promise(resolve => stream.on('finish', resolve));
    }

    const fileSize = fs.statSync(outputPath).size;

    await supabase.from('converted_files').insert([{
      user_email: 'guest',
      original_name: req.file.originalname,
      converted_path: outputFilename,
      file_size: fileSize,
      original_type: ext,
      status: 'pending_download'
    }]);

    fs.unlinkSync(req.file.path);

    console.log('✅ Converted:', outputFilename);

    res.json({
      success: true,
      message: 'File converted! Verify your email to download.',
      convertedFileName: outputFilename,
      fileName: req.file.originalname,
      fileSize: fileSize
    });

  } catch (error) {
    console.error('❌ Conversion error:', error);
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Conversion failed. Please try again.' });
  }
});

// ═══════════════════════════════════════
// SEND OTP
// ═══════════════════════════════════════
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    // Check existing user
    const { data: existingUser } = await supabase.from('users').select('id').eq('email', email.toLowerCase().trim()).single();

    if (existingUser) {
      await supabase.from('users').update({ otp, otp_expiry: otpExpiry.toISOString(), is_verified: false }).eq('id', existingUser.id);
    } else {
      await supabase.from('users').insert([{ email: email.toLowerCase().trim(), otp, otp_expiry: otpExpiry.toISOString(), is_verified: false, created_at: new Date().toISOString() }]);
    }

    await sendOTPEmail(email, otp);
    console.log(`📧 OTP sent to ${email}: ${otp}`);

    res.json({ success: true, message: 'Verification code sent!' });
  } catch (error) {
    console.error('OTP error:', error);
    res.status(500).json({ error: 'Failed to send code' });
  }
});

// ═══════════════════════════════════════
// VERIFY OTP & LOGIN
// ═══════════════════════════════════════
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: 'Email and code required' });

    const { data: user, error } = await supabase.from('users').select('*').eq('email', email.toLowerCase().trim()).single();

    if (error || !user) return res.status(400).json({ error: 'No account found' });
    if (user.otp !== otp) return res.status(400).json({ error: 'Invalid code' });
    if (new Date(user.otp_expiry) < new Date()) return res.status(400).json({ error: 'Code expired. Request new one.' });

    await supabase.from('users').update({ is_verified: true, otp: null, otp_expiry: null, last_login: new Date().toISOString() }).eq('id', user.id);

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ success: true, token, user: { id: user.id, email: user.email } });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ═══════════════════════════════════════
// DOWNLOAD (Requires Auth)
// ═══════════════════════════════════════
app.get('/api/download/:filename', auth, async (req, res) => {
  const filePath = path.join(__dirname, 'converted', req.params.filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Update file owner
  await supabase.from('converted_files').update({ user_email: req.user.email, status: 'downloaded' }).eq('converted_path', req.params.filename);

  res.download(filePath, 'converted.pdf');
});

// ═══════════════════════════════════════
// GET USER PROFILE
// ═══════════════════════════════════════
app.get('/api/user/profile', auth, async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count } = await supabase.from('converted_files').select('*', { count: 'exact', head: true }).eq('user_email', req.user.email).gte('converted_at', today.toISOString());

  res.json({
    email: req.user.email,
    dailyCount: count || 0,
    dailyLimit: DAILY_LIMIT,
    remaining: Math.max(0, DAILY_LIMIT - (count || 0))
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('✅ ConvertX API running on port', PORT);
});

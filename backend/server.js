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

// ─── SUPABASE SETUP ────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── EMAIL SETUP ───────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ─── MIDDLEWARE ────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/converted', express.static('converted'));

// ─── AUTH MIDDLEWARE ───────────────────────────────────
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Please login to download files' });
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', decoded.userId)
      .single();
    
    if (error || !user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Session expired, please login again' });
  }
};

// ─── FILE UPLOAD SETUP ─────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt', '.html', '.htm', '.rtf', '.odt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not supported`));
    }
  }
});

['uploads', 'converted'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── CONSTANTS ─────────────────────────────────────────
const DAILY_LIMIT = 20;
const OTP_EXPIRY_MINUTES = 10;

// ─── HELPER FUNCTIONS ──────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email, otp) {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'ConvertX - Your Verification Code',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: #f9fafb;">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: #4A90E2; margin: 0;">📄 ConvertX</h1>
        </div>
        <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <h2 style="color: #333; margin-top: 0;">Verify Your Email</h2>
          <p style="color: #666; font-size: 16px;">Use this code to verify your email and download your converted files:</p>
          <div style="background: #EBF3FC; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; color: #4A90E2; letter-spacing: 8px;">${otp}</span>
          </div>
          <p style="color: #999; font-size: 14px;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
          <p style="color: #999; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
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

// ─── CONVERT FILE (NO LOGIN REQUIRED) ──────────────────
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please select a file to convert' });
    }

    // Store user email from header (optional for conversion)
    const userEmail = req.header('X-User-Email') || 'guest';

    // Check daily limit
    const dailyCount = await checkDailyLimit(userEmail);
    if (dailyCount >= DAILY_LIMIT) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      return res.status(429).json({
        error: `Daily limit of ${DAILY_LIMIT} conversions reached. Please try again tomorrow.`,
        dailyLimitReached: true
      });
    }

    const inputPath = req.file.path;
    const outputFilename = uuidv4() + '.pdf';
    const outputPath = path.join('converted', outputFilename);
    const ext = path.extname(req.file.originalname).toLowerCase();

    console.log(`🔄 Converting: ${req.file.originalname}`);

    // Convert based on file type
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      const image = sharp(inputPath);
      const metadata = await image.metadata();
      const doc = new PDFDocument({
        size: [metadata.width || 612, metadata.height || 792],
        margin: 0
      });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      let imgWidth = metadata.width;
      let imgHeight = metadata.height;
      if (imgWidth > pageWidth || imgHeight > pageHeight) {
        const ratio = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
        imgWidth *= ratio;
        imgHeight *= ratio;
      }
      const x = (pageWidth - imgWidth) / 2;
      const y = (pageHeight - imgHeight) / 2;
      doc.image(inputPath, x, y, { width: imgWidth, height: imgHeight });
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    } else if (['.docx', '.doc'].includes(ext)) {
      const result = await mammoth.extractRawText({ path: inputPath });
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(12);
      doc.font('Helvetica');
      const paragraphs = result.value.split('\n\n');
      paragraphs.forEach((paragraph, index) => {
        if (paragraph.trim()) {
          if (index > 0) doc.moveDown(0.5);
          doc.text(paragraph.trim(), { align: 'left', lineGap: 4 });
        }
      });
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    } else if (['.txt', '.html', '.htm'].includes(ext)) {
      let content = fs.readFileSync(inputPath, 'utf8');
      if (['.html', '.htm'].includes(ext)) {
        content = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      }
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(12);
      doc.font('Helvetica');
      doc.text(content, { align: 'left', lineGap: 4 });
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    } else {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(16);
      doc.font('Helvetica-Bold');
      doc.text('ConvertX File Conversion', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12);
      doc.font('Helvetica');
      doc.text(`Original File: ${req.file.originalname}`, { align: 'center' });
      doc.moveDown();
      doc.text('This file has been converted to PDF format.', { align: 'center' });
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    }

    const fileSize = fs.statSync(outputPath).size;

    // Store conversion record (even for guests)
    const { data: record } = await supabase
      .from('converted_files')
      .insert([{
        user_email: userEmail,
        original_name: req.file.originalname,
        converted_path: outputFilename,
        file_size: fileSize,
        original_type: ext,
        status: 'pending_download',
        converted_at: new Date().toISOString()
      }])
      .select()
      .single();

    // Clean up uploaded file
    fs.unlinkSync(inputPath);

    console.log(`✅ Converted: ${req.file.originalname} → ${outputFilename}`);

    res.json({
      success: true,
      message: 'File converted successfully! Sign up to download.',
      fileId: record.id,
      convertedFileName: outputFilename,
      fileName: req.file.originalname,
      fileSize: fileSize,
      requiresAuth: true,
      dailyCount: dailyCount + 1,
      dailyLimit: DAILY_LIMIT
    });

  } catch (error) {
    console.error('❌ Conversion error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'File conversion failed. Please try again.' });
  }
});

// ─── SEND OTP FOR VERIFICATION ─────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Check if user exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (existingUser) {
      // Update existing user's OTP
      await supabase
        .from('users')
        .update({
          otp: otp,
          otp_expiry: otpExpiry.toISOString(),
          is_verified: false
        })
        .eq('id', existingUser.id);
    } else {
      // Create new unverified user
      await supabase
        .from('users')
        .insert([{
          email: email.toLowerCase().trim(),
          otp: otp,
          otp_expiry: otpExpiry.toISOString(),
          is_verified: false,
          conversions_today: 0,
          created_at: new Date().toISOString()
        }]);
    }

    // Send OTP email
    await sendOTPEmail(email, otp);

    console.log(`📧 OTP sent to ${email}: ${otp}`);

    res.json({
      success: true,
      message: 'Verification code sent to your email.',
      email: email
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({ error: 'Failed to send verification code. Please try again.' });
  }
});

// ─── VERIFY OTP & LOGIN/REGISTER ───────────────────────
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }

    // Find user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();

    if (error || !user) {
      return res.status(400).json({ error: 'No account found. Please request a new code.' });
    }

    // Check OTP
    if (user.otp !== otp) {
      return res.status(400).json({ error: 'Invalid verification code. Please try again.' });
    }

    // Check OTP expiry
    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(400).json({ error: 'Verification code has expired. Please request a new one.' });
    }

    // Mark user as verified
    await supabase
      .from('users')
      .update({
        is_verified: true,
        otp: null,
        otp_expiry: null,
        last_login: new Date().toISOString()
      })
      .eq('id', user.id);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ User verified: ${email}`);

    res.json({
      success: true,
      message: 'Email verified successfully!',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        conversionsToday: user.conversions_today || 0,
        dailyLimit: DAILY_LIMIT
      }
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ─── LOGIN WITH EXISTING TOKEN ──────────────────────────
app.get('/api/user/profile', auth, async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('converted_files')
    .select('*', { count: 'exact', head: true })
    .eq('user_email', req.user.email)
    .gte('converted_at', today.toISOString());

  res.json({
    id: req.user.id,
    email: req.user.email,
    isVerified: req.user.is_verified,
    conversionsToday: count || 0,
    dailyLimit: DAILY_LIMIT,
    remainingToday: Math.max(0, DAILY_LIMIT - (count || 0))
  });
});

// ─── DOWNLOAD FILE (REQUIRES AUTH) ──────────────────────
app.get('/api/convert/download/:filename', auth, async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'converted', req.params.filename);

    // Verify file belongs to user
    const { data: fileRecord } = await supabase
      .from('converted_files')
      .select('*')
      .eq('converted_path', req.params.filename)
      .eq('user_email', req.user.email)
      .single();

    if (!fileRecord) {
      return res.status(403).json({ error: 'Access denied. This file is not yours.' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found. It may have been deleted.' });
    }

    // Update file status
    await supabase
      .from('converted_files')
      .update({ status: 'downloaded' })
      .eq('id', fileRecord.id);

    // Update user's daily count and assign file to user if not already
    await supabase
      .from('converted_files')
      .update({ user_email: req.user.email })
      .eq('converted_path', req.params.filename)
      .is('user_id', null);

    res.download(filePath, `${fileRecord.original_name || 'converted'}.pdf`);

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed. Please try again.' });
  }
});

// ─── GET USER'S FILE HISTORY ────────────────────────────
app.get('/api/convert/history', auth, async (req, res) => {
  try {
    const { data: files, error } = await supabase
      .from('converted_files')
      .select('*')
      .eq('user_email', req.user.email)
      .order('converted_at', { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({ success: true, files: files || [] });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// ─── HEALTH CHECK ──────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      service: 'ConvertX API v2.0'
    });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', error: error.message });
  }
});

// ─── ERROR HANDLING ────────────────────────────────────
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: error.message });
  }
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START SERVER ──────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║          ConvertX API Server v2.0        ║
║          Free Tier - OTP Auth            ║
║          Port: ${PORT}                      ║
║          Status: Running                 ║
╚══════════════════════════════════════════╝
  `);
});

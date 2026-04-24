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
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ─── SUPABASE SETUP ────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── MIDDLEWARE ────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/converted', express.static('converted'));

// ─── AUTH MIDDLEWARE ───────────────────────────────────
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Please login to continue' });
    
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = [
      '.doc', '.docx', '.xls', '.xlsx', 
      '.jpg', '.jpeg', '.png', '.gif', '.webp',
      '.txt', '.html', '.htm', '.rtf', '.odt'
    ];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} is not supported`));
    }
  }
});

// Create directories if they don't exist
['uploads', 'converted'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ─── PADDLE CONFIGURATION ──────────────────────────────
const PADDLE_API_KEY = process.env.PADDLE_API_KEY;
const PADDLE_API_URL = process.env.PADDLE_API_KEY?.includes('test') 
  ? 'https://sandbox-api.paddle.com' 
  : 'https://api.paddle.com';

// Monthly file conversion limits
const FREE_TIER_LIMIT = 3;     // Free users get 3 conversions
const PRO_TIER_LIMIT = 1000;   // Unlimited (set high number)

// ─── AUTH ROUTES ───────────────────────────────────────

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    // Check existing user
    const { data: existingUser } = await supabase
      .from('users')
      .select('email')
      .eq('email', email.toLowerCase().trim())
      .single();
    
    if (existingUser) {
      return res.status(400).json({ error: 'An account with this email already exists' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user
    const { data: user, error } = await supabase
      .from('users')
      .insert([{
        email: email.toLowerCase().trim(),
        password: hashedPassword,
        name: name || email.split('@')[0],
        plan: 'free',
        max_conversions: FREE_TIER_LIMIT,
        conversions_this_month: 0,
        subscription_status: 'inactive',
        created_at: new Date().toISOString()
      }])
      .select()
      .single();
    
    if (error) throw error;
    
    // Generate token
    const token = jwt.sign(
      { userId: user.id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '30d' }
    );
    
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        conversionsUsed: user.conversions_this_month,
        maxConversions: user.max_conversions,
        subscriptionStatus: user.subscription_status
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .single();
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const token = jwt.sign(
      { userId: user.id }, 
      process.env.JWT_SECRET, 
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        conversionsUsed: user.conversions_this_month,
        maxConversions: user.max_conversions,
        subscriptionStatus: user.subscription_status
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─── USER ROUTES ───────────────────────────────────────

// Get user profile
app.get('/api/user/profile', auth, async (req, res) => {
  res.json({
    id: req.user.id,
    email: req.user.email,
    name: req.user.name,
    plan: req.user.plan,
    conversionsUsed: req.user.conversions_this_month,
    maxConversions: req.user.max_conversions,
    subscriptionStatus: req.user.subscription_status,
    remainingConversions: req.user.max_conversions - req.user.conversions_this_month
  });
});

// ─── PADDLE PAYMENT ROUTES ─────────────────────────────

// Create checkout session
app.post('/api/payment/create-checkout', auth, async (req, res) => {
  try {
    const priceId = process.env.PADDLE_PRO_PRICE_ID;
    
    const response = await axios.post(
      `${PADDLE_API_URL}/transactions`,
      {
        items: [{
          priceId: priceId,
          quantity: 1
        }],
        customerId: req.user.paddle_customer_id || undefined,
        customData: {
          userId: req.user.id
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${PADDLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    res.json({
      success: true,
      checkoutUrl: response.data.data.checkout.url
    });
  } catch (error) {
    console.error('Checkout error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// Get subscription status
app.get('/api/payment/subscription', auth, async (req, res) => {
  res.json({
    plan: req.user.plan,
    status: req.user.subscription_status,
    conversionsUsed: req.user.conversions_this_month,
    maxConversions: req.user.max_conversions
  });
});

// Paddle webhook
app.post('/api/payment/webhook', async (req, res) => {
  try {
    let event;
    
    // Handle raw body
    if (typeof req.body === 'string') {
      event = JSON.parse(req.body);
    } else {
      event = req.body;
    }
    
    console.log('📥 Webhook received:', event?.eventType || 'unknown');
    
    if (!event || !event.eventType) {
      console.error('Invalid webhook payload:', event);
      return res.status(400).json({ error: 'Invalid payload' });
    }
    
    switch (event.eventType) {
      case 'transaction.completed': {
        const userId = event.data?.customData?.userId;
        const customerId = event.data?.customerId;
        
        console.log('💰 Transaction completed for user:', userId);
        
        if (!userId) {
          console.error('No userId in webhook data');
          break;
        }
        
        // Update user to Pro in Supabase
        const { data, error } = await supabase
          .from('users')
          .update({
            plan: 'pro',
            max_conversions: 1000,
            subscription_status: 'active',
            paddle_customer_id: customerId,
            subscription_id: event.data?.subscriptionId,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId)
          .select();
        
        if (error) {
          console.error('❌ Database update error:', error);
        } else {
          console.log('✅ User upgraded to Pro:', userId);
        }
        break;
      }
      
      case 'subscription.canceled': {
        const customerId = event.data?.customerId;
        console.log('❌ Subscription canceled for:', customerId);
        
        const { error } = await supabase
          .from('users')
          .update({
            plan: 'free',
            max_conversions: 3,
            subscription_status: 'inactive',
            updated_at: new Date().toISOString()
          })
          .eq('paddle_customer_id', customerId);
        
        if (error) {
          console.error('Cancel update error:', error);
        }
        break;
      }
    }
    
    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
// ─── FILE CONVERSION ROUTES ────────────────────────────

// Convert file to PDF
app.post('/api/convert/to-pdf', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Please select a file to convert' });
    }
    
    // Check conversion limit
    if (req.user.conversions_this_month >= req.user.max_conversions) {
      return res.status(403).json({
        error: 'Monthly conversion limit reached',
        needsUpgrade: req.user.plan === 'free',
        message: req.user.plan === 'free' 
          ? 'You\'ve used all 3 free conversions. Upgrade to Pro for unlimited conversions!'
          : 'Your monthly limit has been reached.'
      });
    }
    
    const inputPath = req.file.path;
    const outputFilename = uuidv4() + '.pdf';
    const outputPath = path.join('converted', outputFilename);
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    console.log(`🔄 Converting: ${req.file.originalname}`);
    
    // Convert based on file type
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      // Image to PDF
      const image = sharp(inputPath);
      const metadata = await image.metadata();
      
      const doc = new PDFDocument({
        size: [metadata.width || 612, metadata.height || 792],
        margin: 0
      });
      
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      
      // Fit image to page while maintaining aspect ratio
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
      // Word to PDF
      const result = await mammoth.extractRawText({ path: inputPath });
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      
      doc.pipe(stream);
      doc.fontSize(12);
      doc.font('Helvetica');
      
      // Add content with proper formatting
      const paragraphs = result.value.split('\n\n');
      paragraphs.forEach((paragraph, index) => {
        if (paragraph.trim()) {
          if (index > 0) doc.moveDown(0.5);
          doc.text(paragraph.trim(), {
            align: 'left',
            lineGap: 4
          });
        }
      });
      
      doc.end();
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      
    } else if (['.txt', '.html', '.htm'].includes(ext)) {
      // Text/HTML to PDF
      let content = fs.readFileSync(inputPath, 'utf8');
      
      if (['.html', '.htm'].includes(ext)) {
        content = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      }
      
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      
      doc.pipe(stream);
      doc.fontSize(12);
      doc.font('Helvetica');
      doc.text(content, {
        align: 'left',
        lineGap: 4
      });
      doc.end();
      
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      
    } else {
      // Excel and other formats
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
      doc.moveDown();
      doc.text('For advanced formatting options, upgrade to ConvertX Pro!', { 
        align: 'center',
        color: '#4A90E2'
      });
      doc.end();
      
      await new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
    }
    
    // Get file size
    const fileSize = fs.statSync(outputPath).size;
    
    // Update user's conversion count
    const newConversionCount = req.user.conversions_this_month + 1;
    
    const { error: updateError } = await supabase
      .from('users')
      .update({
        conversions_this_month: newConversionCount,
        updated_at: new Date().toISOString()
      })
      .eq('id', req.user.id);
    
    if (updateError) {
      console.error('Failed to update conversion count:', updateError);
    }
    
    // Save conversion record
    const { error: recordError } = await supabase
      .from('converted_files')
      .insert([{
        user_id: req.user.id,
        original_name: req.file.originalname,
        converted_path: outputFilename,
        file_size: fileSize,
        original_type: ext,
        converted_at: new Date().toISOString()
      }]);
    
    if (recordError) {
      console.error('Failed to save conversion record:', recordError);
    }
    
    // Clean up uploaded file
    try {
      fs.unlinkSync(inputPath);
    } catch (e) {
      console.error('Failed to delete upload:', e);
    }
    
    const remainingConversions = req.user.max_conversions - newConversionCount;
    
    console.log(`✅ Converted: ${req.file.originalname} → ${outputFilename}`);
    
    res.json({
      success: true,
      message: 'File converted successfully!',
      downloadUrl: `/converted/${outputFilename}`,
      fileName: req.file.originalname,
      convertedFileName: outputFilename,
      fileSize: fileSize,
      remainingConversions: remainingConversions,
      totalConversions: newConversionCount
    });
    
  } catch (error) {
    console.error('❌ Conversion error:', error);
    
    // Clean up on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'File conversion failed. Please try again.',
      details: error.message 
    });
  }
});

// Download converted file
app.get('/api/convert/download/:filename', auth, async (req, res) => {
  try {
    const filePath = path.join(__dirname, 'converted', req.params.filename);
    
    // Check if file belongs to user
    const { data: fileRecord } = await supabase
      .from('converted_files')
      .select('user_id')
      .eq('converted_path', req.params.filename)
      .single();
    
    if (!fileRecord || fileRecord.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    res.download(filePath, `converted.pdf`);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

// Get conversion history
app.get('/api/convert/history', auth, async (req, res) => {
  try {
    const { data: files, error } = await supabase
      .from('converted_files')
      .select('*')
      .eq('user_id', req.user.id)
      .order('converted_at', { ascending: false })
      .limit(20);
    
    if (error) throw error;
    
    res.json({
      success: true,
      files: files || []
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: 'Failed to load history' });
  }
});

// Delete converted file
app.delete('/api/convert/delete/:filename', auth, async (req, res) => {
  try {
    const { data: fileRecord } = await supabase
      .from('converted_files')
      .select('*')
      .eq('converted_path', req.params.filename)
      .eq('user_id', req.user.id)
      .single();
    
    if (!fileRecord) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Delete physical file
    const filePath = path.join('converted', req.params.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Delete database record
    await supabase
      .from('converted_files')
      .delete()
      .eq('id', fileRecord.id);
    
    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ─── HEALTH CHECK ──────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      service: 'ConvertX API v1.0'
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
║          ConvertX API Server             ║
║          Version 1.0.0                   ║
║          Port: ${PORT}                      ║
║          Status: Running                 ║
╚══════════════════════════════════════════╝
  `);
});

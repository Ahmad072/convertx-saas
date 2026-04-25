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
const { createClient } = require('@supabase/supabase-js');

const app = express();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.use(cors());
app.use(express.json());
app.use('/converted', express.static('converted'));

// Create folders
['uploads', 'converted'].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// File upload setup
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});

const upload = multer({ 
  storage, 
  limits: { fileSize: 50 * 1024 * 1024 } 
});

// ═══════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    service: 'ConvertX API',
    time: new Date().toISOString()
  });
});

// ═══════════════════════════════════════
// CONVERT FILE TO PDF
// ═══════════════════════════════════════
app.post('/api/convert', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const outputFilename = uuidv4() + '.pdf';
    const outputPath = path.join('converted', outputFilename);
    const ext = path.extname(req.file.originalname).toLowerCase();
    
    console.log('Converting:', req.file.originalname);

    // Different conversion based on file type
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      // Image to PDF
      const image = sharp(req.file.path);
      const metadata = await image.metadata();
      const doc = new PDFDocument({ 
        size: [metadata.width || 612, metadata.height || 792],
        margin: 0 
      });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.image(req.file.path, 0, 0, { 
        fit: [doc.page.width, doc.page.height], 
        align: 'center', 
        valign: 'center' 
      });
      doc.end();
      await new Promise(resolve => stream.on('finish', resolve));
      
    } else if (['.docx', '.doc'].includes(ext)) {
      // Word to PDF
      const result = await mammoth.extractRawText({ path: req.file.path });
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(12);
      doc.font('Helvetica');
      const paragraphs = result.value.split('\n\n');
      paragraphs.forEach((para, i) => {
        if (para.trim()) {
          if (i > 0) doc.moveDown(0.5);
          doc.text(para.trim(), { align: 'left', lineGap: 4 });
        }
      });
      doc.end();
      await new Promise(resolve => stream.on('finish', resolve));
      
    } else {
      // Text/HTML/Other to PDF
      let content = '';
      if (['.txt', '.html', '.htm'].includes(ext)) {
        content = fs.readFileSync(req.file.path, 'utf8');
        if (['.html', '.htm'].includes(ext)) {
          content = content.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        }
      } else {
        content = `Converted from: ${req.file.originalname}\n\nThis file has been converted to PDF by ConvertX.`;
      }
      
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);
      doc.fontSize(12);
      doc.font('Helvetica');
      doc.text(content, { align: 'left', lineGap: 4 });
      doc.end();
      await new Promise(resolve => stream.on('finish', resolve));
    }

    const fileSize = fs.statSync(outputPath).size;

    // Save to database
    await supabase.from('converted_files').insert([{
      user_email: 'guest',
      original_name: req.file.originalname,
      converted_path: outputFilename,
      file_size: fileSize,
      original_type: ext,
      status: 'pending_download'
    }]);

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    console.log('✅ Converted:', outputFilename);

    res.json({
      success: true,
      message: 'File converted successfully!',
      convertedFileName: outputFilename,
      fileName: req.file.originalname,
      fileSize: fileSize
    });

  } catch (error) {
    console.error('❌ Conversion error:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Conversion failed. Please try again.' });
  }
});

// ═══════════════════════════════════════
// DOWNLOAD FILE
// ═══════════════════════════════════════
app.get('/api/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'converted', req.params.filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'converted.pdf');
  } else {
    res.status(404).json({ error: 'File not found' });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('✅ ConvertX API running on port', PORT);
  console.log('📍 Health: /api/health');
  console.log('📍 Convert: POST /api/convert');
  console.log('📍 Download: GET /api/download/:filename');
});

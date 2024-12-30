const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const multer = require('multer');
const helmet = require('helmet');
const cors = require('cors');
const { body, validationResult } = require('express-validator');
const morgan = require('morgan');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'All4Jesus';

console.log('Starting server with the following configuration:');
console.log(`PORT: ${PORT}`);
console.log(`ADMIN_PASSWORD: ${ADMIN_PASSWORD ? '*****' : 'Not Set'}`);

// Directory paths
const DATA_DIR = path.join(__dirname, 'data');
const IMAGES_DIR = path.join(__dirname, 'images');
const CSS_DIR = path.join(__dirname, 'css');
const JS_DIR = path.join(__dirname, 'js');

// Middleware setup
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Updated CORS configuration
app.use(cors({
  origin: ['https://www.newselectric.com', 'https://logan-new.github.io'], // Allowed origins
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed methods
}));

// Helmet with basic security headers
app.use(helmet());

// Logging middleware
app.use(morgan('combined'));

// Static file serving
app.use('/css', express.static(CSS_DIR));
app.use('/js', express.static(JS_DIR));
app.use('/images', express.static(IMAGES_DIR));
app.use(express.static(__dirname));

// Updated CSP middleware
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self' https://news-electric.onrender.com; font-src 'self' https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;"
  );
  next();
});

// Ensure required files exist
const ensureFileExists = async (filePath, defaultContent = '{}') => {
  try {
    await fs.access(filePath);
    console.log(`File exists: ${filePath}`);
  } catch {
    console.log(`File missing, creating: ${filePath}`);
    await fs.writeFile(filePath, defaultContent, 'utf8');
  }
};

const initializeFiles = async () => {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await ensureFileExists(path.join(DATA_DIR, 'services.json'), JSON.stringify({ services: [] }, null, 2));
    console.log('Initialization of directories and files completed.');
  } catch (err) {
    console.error('Critical error during initialization:', err);
    process.exit(1); // Exit if initialization fails
  }
};
initializeFiles();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(IMAGES_DIR, { recursive: true });
      cb(null, IMAGES_DIR);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanFilename = file.originalname.replace(/\s+/g, '_');
    cb(null, `${timestamp}-${cleanFilename}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 40 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error('Invalid file type. Only JPG, PNG, and GIF are allowed.'));
    } else {
      cb(null, true);
    }
  },
});

// Routes for serving HTML pages
app.use(express.static(__dirname));
app.get('/index', (req, res) => {
  console.log('GET request to /');
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/about', (req, res) => {
  console.log('GET request to /about');
  res.sendFile(path.join(__dirname, 'about.html'));
});
app.get('/services', (req, res) => {
  console.log('GET request to /services');
  res.sendFile(path.join(__dirname, 'services.html'));
});
app.get('/upload', (req, res) => {
  console.log('GET request to /upload');
  res.sendFile(path.join(__dirname, 'upload.html'));
});

// Health Check Endpoint
app.get('/healthz', (req, res) => {
  console.log('GET request to /healthz');
  res.status(200).send('OK');
});

// Admin authentication route
app.post('/api/admin-auth', (req, res) => {
  console.log('POST request to /api/admin-auth');
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true, redirect: '/upload' });
  }
  res.status(401).json({ success: false, message: 'Incorrect password.' });
});

// Route to serve services.json
app.get('/api/services', async (req, res) => {
  console.log('GET request to /api/services');
  try {
    const servicesPath = path.join(DATA_DIR, 'services.json');
    const servicesData = await fs.readFile(servicesPath, 'utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.json(JSON.parse(servicesData));
  } catch (err) {
    console.error('Error reading services.json:', err);
    res.status(500).json({ error: 'Failed to retrieve services data.' });
  }
});

// Add a new service
app.post(
  '/api/admin/add-service',
  upload.array('images', 40),
  [
    body('name').isLength({ min: 3 }).withMessage('Name must be at least 3 characters long'),
    body('description').isLength({ min: 10 }).withMessage('Description must be at least 10 characters long'),
  ],
  async (req, res) => {
    console.log('POST request to /api/admin/add-service');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, description, coverPhoto } = req.body;
    const images = req.files.map((file) => `/images/${file.filename}`);
    if (images.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    try {
      const servicesPath = path.join(DATA_DIR, 'services.json');
      const servicesData = JSON.parse(await fs.readFile(servicesPath, 'utf-8') || '{}');
      servicesData.services.push({
        id: Date.now().toString(),
        name,
        description,
        images,
        coverPhoto: coverPhoto ? `/images/${coverPhoto}` : images[0],
      });
      await fs.writeFile(servicesPath, JSON.stringify(servicesData, null, 2));
      res.json({ success: true, message: 'Service added successfully!' });
    } catch (err) {
      console.error('Error saving new service:', err);
      res.status(500).json({ error: 'Failed to save new service.' });
    }
  }
);

// Delete a service by ID
app.delete('/api/admin/delete-service/:id', async (req, res) => {
  const { id } = req.params;
  console.log('DELETE request to /api/admin/delete-service with ID:', id);

  const servicesPath = path.join(DATA_DIR, 'services.json');
  try {
    const servicesData = JSON.parse(await fs.readFile(servicesPath, 'utf-8'));

    const updatedServices = servicesData.services.filter((service) => service.id !== id);

    if (updatedServices.length === servicesData.services.length) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    await fs.writeFile(servicesPath, JSON.stringify({ services: updatedServices }, null, 2));
    res.json({ success: true, message: 'Service deleted successfully!' });
  } catch (err) {
    console.error('Error deleting service:', err);
    res.status(500).json({ error: 'Failed to delete service.' });
  }
});

// Update an existing service by ID
app.put('/api/admin/update-service/:id', upload.array('images', 40), async (req, res) => {
  const { id } = req.params;
  const { name, description, coverPhoto } = req.body;
  const images = req.files.map((file) => `/images/${file.filename}`);

  console.log('PUT request to /api/admin/update-service with ID:', id);

  const servicesPath = path.join(DATA_DIR, 'services.json');
  try {
    const servicesData = JSON.parse(await fs.readFile(servicesPath, 'utf-8'));
    const serviceIndex = servicesData.services.findIndex((service) => service.id === id);

    if (serviceIndex === -1) {
      return res.status(404).json({ error: 'Service not found.' });
    }

    const service = servicesData.services[serviceIndex];
    if (name) service.name = name;
    if (description) service.description = description;
    if (images.length > 0) service.images = service.images.concat(images);
    if (coverPhoto) service.coverPhoto = `/images/${coverPhoto}`;

    await fs.writeFile(servicesPath, JSON.stringify(servicesData, null, 2));
    res.json({ success: true, message: 'Service updated successfully!', service });
  } catch (err) {
    console.error('Error updating service:', err);
    res.status(500).json({ error: 'Failed to update service.' });
  }
});

// Delete an image from the service
app.delete('/api/admin/delete-image', async (req, res) => {
  const { serviceId, imagePath } = req.body;
  const servicesPath = path.join(DATA_DIR, 'services.json');
  
  try {
    const servicesData = JSON.parse(await fs.readFile(servicesPath, 'utf-8'));
    const service = servicesData.services.find((s) => s.id === serviceId);

    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    service.images = service.images.filter((img) => img !== imagePath);

    const imageFilePath = path.join(__dirname, imagePath);
    await fs.unlink(imageFilePath);

    await fs.writeFile(servicesPath, JSON.stringify(servicesData, null, 2));

    res.json({ success: true, message: 'Image deleted successfully!' });
  } catch (err) {
    console.error('Error deleting image:', err);
    res.status(500).json({ error: 'Failed to delete image.' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(`Error on ${req.method} ${req.url}:`, err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// Catch-all for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on dynamic port ${PORT}`);
});

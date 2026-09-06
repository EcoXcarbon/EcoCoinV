import { Router } from 'express';
import { param } from 'express-validator';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import Training from '../models/Training.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { parseScormPackage } from '../services/scormService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, '../../uploads');

const router = Router();

/* ═══════════════════════════════════════════════════════════
   GAP 4: SCORM ROUTES
   Upload, serve, and track SCORM packages
   ═══════════════════════════════════════════════════════════ */

const scormUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for SCORM packages
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are accepted for SCORM packages'), false);
    }
  },
});

// Upload SCORM ZIP, parse manifest, update module
router.post('/upload', authenticate, authorize('admin', 'institution'),
  scormUpload.single('scormPackage'),
  async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No SCORM ZIP file uploaded' });

    const { programId, moduleId } = req.body;
    if (!programId || !moduleId) {
      return res.status(400).json({ error: 'programId and moduleId are required' });
    }

    const program = await Training.findById(programId);
    if (!program) return res.status(404).json({ error: 'Program not found' });

    const mod = program.modules.id(moduleId);
    if (!mod) return res.status(404).json({ error: 'Module not found' });

    // Parse SCORM package
    const scormData = parseScormPackage(req.file.buffer, moduleId, uploadDir);

    // Update module with SCORM data
    mod.type = 'scorm';
    mod.scormVersion = scormData.version;
    mod.scormManifest = scormData.metadata;
    mod.scormLaunchFile = scormData.launchFile;
    if (!mod.title || mod.title === 'New Module') mod.title = scormData.title;

    await program.save();

    res.json({
      message: 'SCORM package uploaded and parsed',
      scormVersion: scormData.version,
      title: scormData.title,
      launchFile: scormData.launchFile,
      organization: scormData.organization,
    });
  } catch (err) {
    if (err.message.includes('Invalid SCORM')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// Serve SCORM launch page (HTML wrapper with SCORM API)
router.get('/:moduleId/launch', authenticate, [
  param('moduleId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findOne({ 'modules._id': req.params.moduleId });
    if (!program) return res.status(404).json({ error: 'Module not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || mod.type !== 'scorm') return res.status(400).json({ error: 'Not a SCORM module' });

    const contentBase = `/uploads/scorm/${req.params.moduleId}`;
    const launchUrl = `${contentBase}/${mod.scormLaunchFile}`;
    const isScorm2004 = mod.scormVersion === '2004';

    // Generate SCORM API wrapper HTML
    const html = `<!DOCTYPE html>
<html><head><title>${mod.title} - SCORM Player</title>
<style>body{margin:0;overflow:hidden}iframe{width:100%;height:100vh;border:none}</style>
<script>
// SCORM ${mod.scormVersion} API Adapter
var API${isScorm2004 ? '_1484_11' : ''} = {
  _data: {},
  _initialized: false,
  ${isScorm2004 ? `
  Initialize: function() { this._initialized = true; return "true"; },
  Terminate: function() { this._save(); this._initialized = false; return "true"; },
  GetValue: function(key) { return this._data[key] || ""; },
  SetValue: function(key, val) { this._data[key] = val; return "true"; },
  Commit: function() { this._save(); return "true"; },
  GetLastError: function() { return "0"; },
  GetErrorString: function() { return ""; },
  GetDiagnostic: function() { return ""; },
  ` : `
  LMSInitialize: function() { this._initialized = true; return "true"; },
  LMSFinish: function() { this._save(); this._initialized = false; return "true"; },
  LMSGetValue: function(key) { return this._data[key] || ""; },
  LMSSetValue: function(key, val) { this._data[key] = val; return "true"; },
  LMSCommit: function() { this._save(); return "true"; },
  LMSGetLastError: function() { return "0"; },
  LMSGetErrorString: function() { return ""; },
  LMSGetDiagnostic: function() { return ""; },
  `}
  _save: function() {
    fetch('/api/v1/scorm/${req.params.moduleId}/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + (document.cookie.match(/token=([^;]+)/)?.[1] || '') },
      body: JSON.stringify(this._data)
    }).catch(function(){});
  },
  _load: function() {
    var self = this;
    fetch('/api/v1/scorm/${req.params.moduleId}/runtime', {
      headers: { 'Authorization': 'Bearer ' + (document.cookie.match(/token=([^;]+)/)?.[1] || '') }
    }).then(function(r){return r.json()}).then(function(d){if(d.data) self._data = d.data;}).catch(function(){});
  }
};
${isScorm2004 ? 'API_1484_11' : 'API'}._load();
</script>
</head><body><iframe src="${launchUrl}" allow="fullscreen"></iframe></body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) { next(err); }
});

// Serve static SCORM content files
router.get('/:moduleId/content/*', authenticate, [
  param('moduleId').isMongoId(),
  handleValidation,
], (req, res, next) => {
  const filePath = req.params[0];
  const safePath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const fullPath = path.join(uploadDir, 'scorm', req.params.moduleId, safePath);

  // Prevent directory traversal
  if (!fullPath.startsWith(path.join(uploadDir, 'scorm', req.params.moduleId))) {
    return res.status(403).json({ error: 'Access denied' });
  }

  res.sendFile(fullPath, (err) => {
    if (err) res.status(404).json({ error: 'File not found' });
  });
});

// SCORM runtime data persistence (save cmi data)
router.post('/:moduleId/runtime', authenticate, [
  param('moduleId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findOne({ 'modules._id': req.params.moduleId });
    if (!program) return res.status(404).json({ error: 'Module not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || mod.type !== 'scorm') return res.status(400).json({ error: 'Not a SCORM module' });

    // Store runtime data keyed by user ID
    if (!mod.scormData) mod.scormData = new Map();
    mod.scormData.set(req.user._id.toString(), req.body);

    // Check for completion
    const cmiData = req.body;
    const isComplete = cmiData['cmi.core.lesson_status'] === 'completed' ||
      cmiData['cmi.core.lesson_status'] === 'passed' ||
      cmiData['cmi.completion_status'] === 'completed' ||
      cmiData['cmi.success_status'] === 'passed';

    if (isComplete) {
      // Extract score if available
      const scoreRaw = cmiData['cmi.core.score.raw'] || cmiData['cmi.score.raw'];
      if (scoreRaw) {
        // Score available — could trigger module completion via progress endpoint
      }
    }

    await program.save();
    res.json({ saved: true, complete: isComplete });
  } catch (err) { next(err); }
});

// Retrieve saved SCORM runtime state
router.get('/:moduleId/runtime', authenticate, [
  param('moduleId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const program = await Training.findOne({ 'modules._id': req.params.moduleId });
    if (!program) return res.status(404).json({ error: 'Module not found' });

    const mod = program.modules.id(req.params.moduleId);
    if (!mod || mod.type !== 'scorm') return res.status(400).json({ error: 'Not a SCORM module' });

    const data = mod.scormData?.get(req.user._id.toString()) || {};
    res.json({ data });
  } catch (err) { next(err); }
});

export default router;

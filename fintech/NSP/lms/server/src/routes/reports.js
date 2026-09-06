import { Router } from 'express';
import { query } from 'express-validator';
import Worker from '../models/Worker.js';
import Credential from '../models/Credential.js';
import Assessment from '../models/Assessment.js';
import PDFDocument from 'pdfkit';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';

const router = Router();

// Export workers as CSV
router.get('/workers/csv', authenticate, authorize('admin', 'institution'), auditLog('REPORT_EXPORT_WORKERS'), async (req, res, next) => {
  try {
    const workers = await Worker.find({ status: { $ne: 'inactive' } })
      .select('registrationId fullName trade district nqfLevel status createdAt cnicMasked')
      .lean();

    const header = 'Registration ID,Name,Trade,District,NQF Level,Status,CNIC (masked),Registered\n';
    const rows = workers.map(w => {
      // Escape CSV fields to prevent injection
      const safe = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      return [
        safe(w.registrationId), safe(w.fullName), safe(w.trade), safe(w.district),
        w.nqfLevel, safe(w.status), safe(w.cnicMasked),
        safe(w.createdAt?.toISOString().split('T')[0]),
      ].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=workers-${Date.now()}.csv`);
    res.send(header + rows);
  } catch (err) { next(err); }
});

// Export credentials as CSV
router.get('/credentials/csv', authenticate, authorize('admin', 'institution'), auditLog('REPORT_EXPORT_CREDENTIALS'), async (req, res, next) => {
  try {
    const creds = await Credential.find()
      .populate('worker', 'fullName trade registrationId')
      .lean();

    const header = 'Credential ID,Worker,Trade,Type,Title,Status,Issued,Valid Until\n';
    const rows = creds.map(c => {
      const safe = (val) => `"${String(val || '').replace(/"/g, '""')}"`;
      return [
        safe(c.credentialId), safe(c.worker?.fullName), safe(c.trade), safe(c.type),
        safe(c.title), safe(c.status),
        safe(c.validFrom?.toISOString().split('T')[0]),
        safe(c.validUntil?.toISOString().split('T')[0]),
      ].join(',');
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=credentials-${Date.now()}.csv`);
    res.send(header + rows);
  } catch (err) { next(err); }
});

// Summary report data
router.get('/summary', authenticate, authorize('admin', 'institution'), [
  query('months').optional().isInt({ min: 1, max: 36 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const months = req.query.months || 12;
    const [workersByTrade, credsByType, assessmentsByStatus, monthlyTrend] = await Promise.all([
      Worker.aggregate([
        { $match: { status: { $ne: 'inactive' } } },
        { $group: { _id: '$trade', count: { $sum: 1 } } },
      ]),
      Credential.aggregate([
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      Assessment.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Worker.aggregate([
        { $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: -1 } },
        { $limit: months },
      ]),
    ]);

    res.json({ workersByTrade, credsByType, assessmentsByStatus, monthlyTrend });
  } catch (err) { next(err); }
});

// Analytics PDF report
router.get('/analytics/pdf', authenticate, authorize('admin', 'institution'), auditLog('REPORT_EXPORT_ANALYTICS_PDF'), async (req, res, next) => {
  try {
    const [totalWorkers, totalCreds, totalAssessments, byTrade, byStatus] = await Promise.all([
      Worker.countDocuments({ status: { $ne: 'inactive' } }),
      Credential.countDocuments(),
      Assessment.countDocuments(),
      Worker.aggregate([{ $match: { status: { $ne: 'inactive' } } }, { $group: { _id: '$trade', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 10 }]),
      Assessment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    ]);

    const doc = new PDFDocument({ margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=analytics-report-${Date.now()}.pdf`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('TalentLedger Analytics Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').fillColor('#666666').text(`Generated: ${new Date().toLocaleDateString('en-PK')}`, { align: 'center' });
    doc.moveDown(1.5);

    // Summary stats
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000').text('Summary Statistics');
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica');
    doc.text(`Total Workers: ${totalWorkers}`);
    doc.text(`Total Credentials Issued: ${totalCreds}`);
    doc.text(`Total Assessments: ${totalAssessments}`);
    doc.moveDown(1);

    // Workers by trade
    doc.fontSize(14).font('Helvetica-Bold').text('Workers by Trade (Top 10)');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    byTrade.forEach(t => {
      doc.text(`  ${t._id || 'Unknown'}: ${t.count}`);
    });
    doc.moveDown(1);

    // Assessments by status
    doc.fontSize(14).font('Helvetica-Bold').text('Assessments by Status');
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    byStatus.forEach(s => {
      doc.text(`  ${s._id || 'Unknown'}: ${s.count}`);
    });

    doc.end();
  } catch (err) { next(err); }
});

export default router;

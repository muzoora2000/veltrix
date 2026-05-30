const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');
const aiController = require('../controllers/aiController');

router.post('/voice-translate', aiController.voiceTranslate);
router.post('/audio-transcribe', aiController.audioTranscribe);
router.post('/reports/generate', authMiddleware, aiController.generateReport);
router.get('/decision/operational-insights', authMiddleware, aiController.operationalInsights);
router.get('/risk/live-summary', authMiddleware, aiController.liveSummary);
router.get('/risk/district-summaries', authMiddleware, aiController.districtSummaries);
router.get('/risk/heatmap', authMiddleware, aiController.heatmap);
router.get('/risk/environmental-index', authMiddleware, aiController.environmentalIndex);
router.all('/health', aiController.proxyHealth);
router.all('/system/ping', aiController.proxyPing);
router.all('/:path(*)', authMiddleware, aiController.proxyWildcard);

module.exports = router;

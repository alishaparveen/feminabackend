const express = require('express');
const router = express.Router();
const {
  listFlaggedComments,
  getCommentModerationDetail,
  moderatorDecision,
  bulkModeration,
  listReports,
  resolveReport
} = require('../controllers/adminModerationController');

router.get('/comments', listFlaggedComments);

router.get('/comments/:id', getCommentModerationDetail);

router.put('/comments/:id', moderatorDecision);

router.post('/comments/bulk', bulkModeration);

router.get('/reports/comments', listReports);

router.put('/reports/:reportId', resolveReport);

module.exports = router;

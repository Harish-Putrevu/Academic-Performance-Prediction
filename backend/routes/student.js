const express = require('express');
const StudentData = require('../models/StudentData');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
const DEMO_MODE = true;
const SUBJECT_CATALOG = [
  'Enterprise Cloud Engineering',
  'Software Engineering',
  'Compiler Design',
  'Natural Language Processing',
  'Data Science',
  'Waste to Wealth',
];

function safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function gradeFromScore(score) {
  if (score >= 90) return 'O';
  if (score >= 80) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 50) return 'B';
  return 'C';
}

function estimateExternalScore(internalMarks, attendance) {
  const att = clamp(safeNum(attendance, 0), 0, 100);
  const internal = clamp(safeNum(internalMarks, 0), 0, 60);
  const score = 8 + (internal / 60) * 24 + Math.max(0, att - 70) * 0.4;
  return Math.round(clamp(score, 0, 40));
}

function performanceLabel(grade) {
  const map = {
    O: 'Outstanding Performance',
    'A+': 'Excellent Performance',
    A: 'Very Good Performance',
    'B+': 'Good Performance',
    B: 'Satisfactory Performance',
    C: 'Needs Improvement',
  };
  return map[grade] || 'Needs Improvement';
}

function toSubjectObject(raw, fallbackName = '') {
  const name = String(raw?.name || fallbackName || '').trim();
  const attendance = clamp(safeNum(raw?.attendance, 0), 0, 100);
  let internalMarks = safeNum(raw?.internalMarks, NaN);
  if (!Number.isFinite(internalMarks)) {
    const marks = safeNum(raw?.marks, 0);
    internalMarks = clamp((marks / 100) * 60, 0, 60);
  }
  internalMarks = clamp(internalMarks, 0, 60);

  let predictedExternalScore = safeNum(raw?.predictedExternalScore, NaN);
  if (!Number.isFinite(predictedExternalScore)) {
    predictedExternalScore = estimateExternalScore(internalMarks, attendance);
  }
  predictedExternalScore = clamp(predictedExternalScore, 0, 40);

  let totalScore = safeNum(raw?.totalScore, NaN);
  if (!Number.isFinite(totalScore)) {
    totalScore = internalMarks + predictedExternalScore;
  }
  totalScore = clamp(totalScore, 0, 100);

  return {
    name,
    attendance: Number(attendance.toFixed(1)),
    internalMarks: Number(internalMarks.toFixed(1)),
    predictedExternalScore: Number(predictedExternalScore.toFixed(1)),
    totalScore: Number(totalScore.toFixed(1)),
    marks: Number(totalScore.toFixed(1)),
  };
}

function summarizeSubjects(subjects) {
  if (!subjects || subjects.length === 0) {
    return { avgAttendance: 0, avgMarks: 0, overallGrade: 'C', riskLevel: 'High' };
  }
  const normalized = subjects.map((s) => toSubjectObject(s));
  const avgAttendance =
    normalized.reduce((sum, s) => sum + safeNum(s.attendance, 0), 0) / normalized.length;
  const avgMarks =
    normalized.reduce((sum, s) => sum + safeNum(s.totalScore, safeNum(s.marks, 0)), 0) /
    normalized.length;
  const overallGrade = gradeFromScore((avgAttendance + avgMarks) / 2);
  let riskLevel = 'Low';
  if (avgAttendance < 75 || avgMarks < 60) riskLevel = 'Medium';
  if (avgAttendance < 65 || avgMarks < 50) riskLevel = 'High';
  const weakSubjects = normalized
    .filter((s) => s.attendance < 75 || s.totalScore < 60)
    .map((s) => s.name);
  const strongSubjects = normalized
    .filter((s) => s.attendance >= 85 && s.totalScore >= 80)
    .map((s) => s.name);
  return { avgAttendance, avgMarks, overallGrade, riskLevel, weakSubjects, strongSubjects };
}

function deterministicStat(name, min, max, salt) {
  const raw = `${name || ''}-${salt}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return min + (hash % (max - min + 1));
}

function pickProfileFromId(userId) {
  const code = deterministicStat(String(userId || ''), 0, 2, 'profile');
  if (code === 0) return 'strong';
  if (code === 1) return 'average';
  return 'weak';
}

function generateDemoSubjectsForUser(userId, profile) {
  const base = String(userId || '');
  const activeProfile = profile || pickProfileFromId(userId);
  const ranges =
    activeProfile === 'strong'
      ? { attendance: [86, 99], internal: [46, 59], external: [28, 39] }
      : activeProfile === 'weak'
        ? { attendance: [70, 82], internal: [24, 42], external: [14, 28] }
        : { attendance: [76, 92], internal: [34, 50], external: [20, 33] };

  const subjects = SUBJECT_CATALOG.map((name, idx) => {
    const attendance = deterministicStat(`${base}-${name}-${idx}`, ranges.attendance[0], ranges.attendance[1], 'att');
    const internalMarks = deterministicStat(`${base}-${name}-${idx}`, ranges.internal[0], ranges.internal[1], 'int');
    const predictedExternalScore = deterministicStat(`${base}-${name}-${idx}`, ranges.external[0], ranges.external[1], 'ext');
    return toSubjectObject({ name, attendance, internalMarks, predictedExternalScore });
  });

  // Force Compiler Design to be a stress subject for average/weak profiles to drive alerts.
  const compiler = subjects.find((s) => s.name === 'Compiler Design');
  if (compiler && activeProfile !== 'strong') {
    compiler.attendance = clamp(compiler.attendance - 8, 70, 100);
    compiler.internalMarks = clamp(compiler.internalMarks - 6, 0, 60);
    compiler.predictedExternalScore = estimateExternalScore(compiler.internalMarks, compiler.attendance);
    compiler.totalScore = Number((compiler.internalMarks + compiler.predictedExternalScore).toFixed(1));
    compiler.marks = compiler.totalScore;
  }

  return subjects;
}

async function getOrCreateDoc(userId) {
  let doc = await StudentData.findOne({ userId });
  if (!doc) {
    const count = await StudentData.countDocuments();
    const studentCode = `S${String(count + 1).padStart(3, '0')}`;
    doc = await StudentData.create({
      userId,
      studentCode,
      attendance: 0,
      internalMarks: 0,
      previousGrade: 'C',
      predictedGrade: 'C',
      subjects: [],
    });
  }
  return doc;
}

async function ensureDemoSubjects(doc) {
  if (!DEMO_MODE) return doc;
  if (Array.isArray(doc.subjects) && doc.subjects.length > 0) return doc;
  doc.subjects = generateDemoSubjectsForUser(doc.userId);
  const summary = summarizeSubjects(doc.subjects);
  doc.attendance = Number(summary.avgAttendance.toFixed(2));
  doc.internalMarks = Number(summary.avgMarks.toFixed(2));
  doc.predictedGrade = summary.overallGrade;
  await doc.save();
  return doc;
}

router.get('/my/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.user.role !== 'admin' && req.user._id.toString() !== userId) {
      return res.status(403).json({ message: 'Access denied for this userId' });
    }
    let doc = await StudentData.findOne({ userId });
    if (!doc) doc = await getOrCreateDoc(userId);
    doc = await ensureDemoSubjects(doc);
    const normalizedSubjects = (doc.subjects || []).map((s) => toSubjectObject(s));
    const summary = summarizeSubjects(doc.subjects || []);
    res.json({
      student: {
        _id: doc._id,
        userId: doc.userId,
        studentCode: doc.studentCode,
        attendance: doc.attendance,
        internalMarks: doc.internalMarks,
        previousGrade: doc.previousGrade,
        predictedGrade: doc.predictedGrade,
        subjects: normalizedSubjects,
      },
      summary,
      demoMode: DEMO_MODE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching student data' });
  }
});

router.post('/subjects', authMiddleware, async (req, res) => {
  try {
    const { subjects } = req.body;
    if (!Array.isArray(subjects) || subjects.length === 0) {
      return res.status(400).json({ message: 'subjects array is required' });
    }
    const sanitized = subjects.map((s) => toSubjectObject(s)).filter((s) => s.name);
    if (sanitized.length === 0) {
      return res.status(400).json({ message: 'No valid subject rows found' });
    }

    const doc = await getOrCreateDoc(req.user._id);
    doc.subjects = sanitized;
    const summary = summarizeSubjects(sanitized);
    doc.attendance = Number(summary.avgAttendance.toFixed(2));
    doc.internalMarks = Number(summary.avgMarks.toFixed(2));
    doc.predictedGrade = summary.overallGrade;
    await doc.save();

    res.json({
      message: 'Subjects saved',
      subjects: doc.subjects.map((s) => toSubjectObject(s)),
      summary,
      demoMode: DEMO_MODE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error saving subjects' });
  }
});

router.post('/demo/generate', authMiddleware, async (req, res) => {
  try {
    const profile = ['strong', 'average', 'weak'].includes(String(req.body?.profile || '').toLowerCase())
      ? String(req.body.profile).toLowerCase()
      : undefined;
    const doc = await getOrCreateDoc(req.user._id);
    doc.subjects = generateDemoSubjectsForUser(req.user._id, profile);
    const summary = summarizeSubjects(doc.subjects);
    doc.attendance = Number(summary.avgAttendance.toFixed(2));
    doc.internalMarks = Number(summary.avgMarks.toFixed(2));
    doc.predictedGrade = summary.overallGrade;
    await doc.save();
    res.json({
      message: 'Demo subjects generated',
      subjects: doc.subjects.map((s) => toSubjectObject(s)),
      summary,
      demoMode: DEMO_MODE,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error generating demo data' });
  }
});

router.post('/timetable', authMiddleware, async (req, res) => {
  return res.status(501).json({
    message:
      'Timetable PDF parsing is disabled in Demo Mode. Data is auto-generated from predefined subjects.',
    demoMode: DEMO_MODE,
  });
});

router.post('/submit', authMiddleware, async (req, res) => {
  try {
    const { attendance, internalMarks, previousGrade } = req.body;
    if (
      attendance === undefined ||
      internalMarks === undefined ||
      previousGrade === undefined ||
      previousGrade === ''
    ) {
      return res.status(400).json({ message: 'All fields are required' });
    }
    const att = Number(attendance);
    const marks = Number(internalMarks);
    if (Number.isNaN(att) || att < 0 || att > 100) {
      return res.status(400).json({ message: 'Attendance must be between 0 and 100' });
    }
    if (Number.isNaN(marks) || marks < 0 || marks > 60) {
      return res.status(400).json({ message: 'Internal marks must be between 0 and 60' });
    }
    const predictedTotal = clamp(marks + estimateExternalScore(marks, att), 0, 100);
    const predictedGrade = gradeFromScore(predictedTotal);
    const doc = await getOrCreateDoc(req.user._id);
    await ensureDemoSubjects(doc);
    doc.attendance = att;
    doc.internalMarks = marks;
    doc.previousGrade = String(previousGrade).trim();
    doc.predictedGrade = predictedGrade;
    await doc.save();
    res.json({
      message: 'Prediction saved',
      predictedGrade,
      predictedTotal: Number(predictedTotal.toFixed(1)),
      performanceText: performanceLabel(predictedGrade),
      recordId: doc._id,
      studentCode: doc.studentCode,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error saving prediction' });
  }
});

router.get('/all', authMiddleware, adminOnly, async (req, res) => {
  try {
    const records = await StudentData.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .lean();
    const students = records.map((r) => ({
      summary: summarizeSubjects(r.subjects || []),
      subjectsDetailed: (r.subjects || []).map((s) => toSubjectObject(s)),
      _id: r._id,
      studentCode: r.studentCode || '—',
      name: r.userId?.name || '—',
      email: r.userId?.email || '—',
      predictedGrade: r.predictedGrade,
      attendance: r.attendance,
      internalMarks: r.internalMarks,
      previousGrade: r.previousGrade,
      subjects: (r.subjects || []).map((s) => s.name),
      subjectsCount: (r.subjects || []).length,
    })).map((s) => ({
      ...s,
      avgMarks: Number(s.summary.avgMarks.toFixed(1)),
      riskLevel: s.summary.riskLevel,
      weakSubjects: s.summary.weakSubjects,
      strongSubjects: s.summary.strongSubjects,
    }));
    res.json({ students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error fetching students' });
  }
});

router.get('/detail/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const doc = await StudentData.findById(req.params.id).populate('userId', 'name email').lean();
    if (!doc) {
      return res.status(404).json({ message: 'Student record not found' });
    }
    const subjects = (doc.subjects || []).map((s) => toSubjectObject(s));
    const summary = summarizeSubjects(subjects);
    return res.json({
      student: {
        _id: doc._id,
        studentCode: doc.studentCode || '—',
        name: doc.userId?.name || '—',
        email: doc.userId?.email || '—',
        predictedGrade: doc.predictedGrade,
        attendance: doc.attendance,
        internalMarks: doc.internalMarks,
        previousGrade: doc.previousGrade,
        subjects,
        summary,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error fetching student detail' });
  }
});

async function updateStudentHandler(req, res) {
  try {
    const { attendance, internalMarks, previousGrade, subjects } = req.body;
    const doc = await StudentData.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Student record not found' });
    }
    if (attendance !== undefined) {
      const att = Number(attendance);
      if (Number.isNaN(att) || att < 0 || att > 100) {
        return res.status(400).json({ message: 'Attendance must be between 0 and 100' });
      }
      doc.attendance = att;
    }
    if (internalMarks !== undefined) {
      const marks = Number(internalMarks);
      if (Number.isNaN(marks) || marks < 0 || marks > 60) {
        return res.status(400).json({ message: 'Internal marks must be between 0 and 60' });
      }
      doc.internalMarks = marks;
    }
    if (previousGrade !== undefined) {
      doc.previousGrade = String(previousGrade).trim();
    }
    if (Array.isArray(subjects)) {
      doc.subjects = subjects.map((s) => toSubjectObject(s)).filter((s) => s.name);
      if (doc.subjects.length > 0) {
        const summary = summarizeSubjects(doc.subjects);
        doc.attendance = Number(summary.avgAttendance.toFixed(2));
        doc.internalMarks = Number(summary.avgMarks.toFixed(2));
      }
    }
    const predictedTotal = clamp(doc.internalMarks + estimateExternalScore(doc.internalMarks, doc.attendance), 0, 100);
    doc.predictedGrade = gradeFromScore(predictedTotal);
    await doc.save();
    res.json({
      message: 'Updated',
      predictedGrade: doc.predictedGrade,
      predictedTotal: Number(predictedTotal.toFixed(1)),
      performanceText: performanceLabel(doc.predictedGrade),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error updating student' });
  }
}

router.put('/update/:id', authMiddleware, adminOnly, updateStudentHandler);
// Backward-compatible alias
router.put('/:id', authMiddleware, adminOnly, updateStudentHandler);

router.put('/:id/subjects', authMiddleware, adminOnly, async (req, res) => {
  try {
    const subjects = Array.isArray(req.body?.subjects) ? req.body.subjects : [];
    if (!subjects.length) {
      return res.status(400).json({ message: 'subjects array is required' });
    }
    const doc = await StudentData.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ message: 'Student record not found' });
    }
    doc.subjects = subjects.map((s) => toSubjectObject(s)).filter((s) => s.name);
    const summary = summarizeSubjects(doc.subjects);
    doc.attendance = Number(summary.avgAttendance.toFixed(2));
    doc.internalMarks = Number(summary.avgMarks.toFixed(2));
    doc.predictedGrade = summary.overallGrade;
    await doc.save();
    return res.json({
      message: 'Subjects updated',
      subjects: doc.subjects.map((s) => toSubjectObject(s)),
      summary,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error updating subjects' });
  }
});

router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const deleted = await StudentData.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Student record not found' });
    }
    res.json({ message: 'Student data deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error deleting student' });
  }
});

module.exports = router;

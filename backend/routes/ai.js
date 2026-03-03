const express = require('express');
const StudentData = require('../models/StudentData');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const chatHistoryStore = new Map();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSubject(raw) {
  const internalMarks = clamp(safeNum(raw?.internalMarks, safeNum(raw?.marks, 0) * 0.6), 0, 60);
  const predictedExternalScore = clamp(
    safeNum(raw?.predictedExternalScore, Math.round((internalMarks / 60) * 26)),
    0,
    40
  );
  const totalScore = clamp(safeNum(raw?.totalScore, internalMarks + predictedExternalScore), 0, 100);
  return {
    name: String(raw?.name || 'Unknown Subject').trim(),
    attendance: clamp(safeNum(raw?.attendance, 0), 0, 100),
    internalMarks,
    predictedExternalScore,
    totalScore,
  };
}

function parseJsonFromText(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  try {
    return JSON.parse(rawText);
  } catch (_) {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(rawText.slice(start, end + 1));
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

function localSubjectAnalysis(subjectRaw) {
  const subject = normalizeSubject(subjectRaw);
  const expectedScore = clamp(Math.ceil(90 - subject.internalMarks), 0, 40);
  const weaknesses = [];
  if (subject.attendance < 75) weaknesses.push(`Attendance is low at ${subject.attendance}%.`);
  if (subject.internalMarks < 36)
    weaknesses.push(`Internal performance is below target (${subject.internalMarks}/60).`);
  if (subject.totalScore < 75)
    weaknesses.push(`Current predicted total is ${subject.totalScore}/100, below A-grade safety.`);
  if (weaknesses.length === 0) {
    weaknesses.push('No major weakness, but consistency and depth practice can unlock 90+.');
  }

  const strategy = [
    `Target at least ${expectedScore}/40 in externals to touch 90+ total.`,
    'Use 45-minute focused blocks: concepts, solved problems, then timed recall.',
    'Create a one-page error log and revise it every 3 days before mock tests.',
    'Solve 2 previous-year papers under timed conditions this week.',
  ];

  const quizQuestions = [
    `Explain one core concept from ${subject.name} in your own words with an example.`,
    `Solve a medium-level ${subject.name} problem and justify each step briefly.`,
    `List three common mistakes in ${subject.name} exams and how to avoid them.`,
  ];

  return { weaknesses, strategy, expectedScore, quizQuestions };
}

function localOverall(subjectsRaw) {
  const subjects = (subjectsRaw || []).map(normalizeSubject);
  if (!subjects.length) {
    return {
      strengths: ['No subject data yet.'],
      weakSubjects: ['Add subject marks and attendance to unlock detailed insights.'],
      gpaEstimate: '5.5',
      improvementPlan: ['Start with complete subject entries and one weekly revision schedule.'],
      motivationalInsight: 'Small daily consistency beats occasional intensity.',
    };
  }
  const avgTotal = subjects.reduce((sum, s) => sum + s.totalScore, 0) / subjects.length;
  const avgAtt = subjects.reduce((sum, s) => sum + s.attendance, 0) / subjects.length;
  const strengths = subjects
    .filter((s) => s.totalScore >= 80 || s.attendance >= 88)
    .map((s) => `${s.name} (${s.totalScore.toFixed(1)}/100, ${s.attendance.toFixed(0)}% attendance)`)
    .slice(0, 4);
  const weakSubjects = subjects
    .filter((s) => s.totalScore < 65 || s.attendance < 75)
    .map((s) => s.name)
    .slice(0, 4);
  const gpaEstimate = clamp((avgTotal / 10) * 0.95 + (avgAtt / 100) * 0.5, 0, 10).toFixed(2);
  const improvementPlan = [
    'Prioritize weak subjects first with 5-day revision cycles.',
    'Increase attendance to at least 85% in every subject.',
    'Take one full-length mock every weekend and review mistakes deeply.',
    'Track progress weekly by comparing test scores and concept clarity.',
  ];
  const motivationalInsight =
    avgTotal >= 80
      ? 'You are already on a high-performing path. Sharpen exam strategy to reach the top band.'
      : 'Your trend can shift fast. A focused two-week sprint can create a visible grade jump.';
  return {
    strengths: strengths.length ? strengths : ['Consistent baseline across multiple subjects.'],
    weakSubjects: weakSubjects.length ? weakSubjects : ['No critical weak subjects currently.'],
    gpaEstimate,
    improvementPlan,
    motivationalInsight,
  };
}

async function askGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;
  const model =
    process.env.GEMINI_MODEL ||
    process.env.GOOGLE_MODEL ||
    'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 700 },
    }),
  });
  if (!response.ok) return null;
  const data = await response.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n').trim() || null;
  return text;
}

async function analyzeHandler(req, res) {
  try {
    const userId = req.body.userId || req.user._id.toString();
    if (req.user.role !== 'professor' && req.user.role !== 'admin' && req.user._id.toString() !== userId) {
      return res.status(403).json({ message: 'Access denied for this userId' });
    }
    const doc = await StudentData.findOne({ userId }).lean();
    const subjects = (doc?.subjects || []).map(normalizeSubject);
    const local = localOverall(subjects);
    const prompt = [
      'Analyze student academic performance and give improvement suggestions.',
      `Subjects JSON: ${JSON.stringify(subjects)}`,
      'Return JSON only with keys: strengths (array), weakSubjects (array), gpaEstimate (string), improvementPlan (array), motivationalInsight (string).',
    ].join('\n');

    const aiText = await askGemini(prompt);
    const parsed = parseJsonFromText(aiText);
    return res.json({
      strengths: Array.isArray(parsed?.strengths) ? parsed.strengths : local.strengths,
      weakSubjects: Array.isArray(parsed?.weakSubjects) ? parsed.weakSubjects : local.weakSubjects,
      gpaEstimate: parsed?.gpaEstimate || local.gpaEstimate,
      improvementPlan: Array.isArray(parsed?.improvementPlan)
        ? parsed.improvementPlan
        : local.improvementPlan,
      motivationalInsight: parsed?.motivationalInsight || local.motivationalInsight,
      source: parsed ? 'gemini' : 'local',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'AI analysis failed' });
  }
}

async function subjectAnalysisHandler(req, res) {
  try {
    const { subject: subjectName, marks, attendance, internalMarks } = req.body || {};
    if (!subjectName) {
      return res.status(400).json({ message: 'subject is required' });
    }
    const subject = normalizeSubject({
      name: subjectName,
      attendance,
      internalMarks,
      marks,
    });
    const local = localSubjectAnalysis(subject);
    const prompt = [
      `Analyze this student's performance in ${subject.name}. Internal marks are out of 60. Suggest how to improve to reach 90+ total. Include:`,
      '- weaknesses',
      '- expected external exam score needed',
      '- study strategy',
      '- 3 practice questions (mock quiz)',
      `Current data: ${JSON.stringify(subject)}`,
      'Return JSON only with keys: weaknesses (array), strategy (array), expectedScore (number), quizQuestions (array).',
    ].join('\n');
    const aiText = await askGemini(prompt);
    const parsed = parseJsonFromText(aiText);
    return res.json({
      weaknesses: Array.isArray(parsed?.weaknesses) ? parsed.weaknesses : local.weaknesses,
      strategy: Array.isArray(parsed?.strategy) ? parsed.strategy : local.strategy,
      expectedScore: Number.isFinite(Number(parsed?.expectedScore))
        ? clamp(Number(parsed.expectedScore), 0, 40)
        : local.expectedScore,
      quizQuestions: Array.isArray(parsed?.quizQuestions) ? parsed.quizQuestions : local.quizQuestions,
      source: parsed ? 'gemini' : 'local',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Subject AI analysis failed' });
  }
}

async function overallHandler(req, res) {
  try {
    const userId = String(req.body?.userId || req.user._id);
    if (
      req.user.role !== 'professor' &&
      req.user.role !== 'admin' &&
      req.user._id.toString() !== userId
    ) {
      return res.status(403).json({ message: 'Access denied for this userId' });
    }

    let subjects = Array.isArray(req.body?.subjects) ? req.body.subjects : [];
    if (!subjects.length) {
      const doc = await StudentData.findOne({ userId }).lean();
      subjects = doc?.subjects || [];
    }
    const normalized = subjects.map(normalizeSubject);
    const local = localOverall(normalized);

    const prompt = [
      'Analyze overall academic performance. Provide:',
      '- strengths',
      '- weak subjects',
      '- GPA estimate',
      '- improvement plan',
      '- motivational insight',
      `Subjects data: ${JSON.stringify(normalized)}`,
      'Return JSON only with keys: strengths (array), weakSubjects (array), gpaEstimate (string), improvementPlan (array), motivationalInsight (string).',
    ].join('\n');

    const aiText = await askGemini(prompt);
    const parsed = parseJsonFromText(aiText);
    return res.json({
      strengths: Array.isArray(parsed?.strengths) ? parsed.strengths : local.strengths,
      weakSubjects: Array.isArray(parsed?.weakSubjects) ? parsed.weakSubjects : local.weakSubjects,
      gpaEstimate: parsed?.gpaEstimate || local.gpaEstimate,
      improvementPlan: Array.isArray(parsed?.improvementPlan)
        ? parsed.improvementPlan
        : local.improvementPlan,
      motivationalInsight: parsed?.motivationalInsight || local.motivationalInsight,
      source: parsed ? 'gemini' : 'local',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Overall AI analysis failed' });
  }
}

async function chatHandler(req, res) {
  try {
    const userId = String(req.body.userId || req.user._id);
    const message = String(req.body.message || '').trim();
    if (!message) {
      return res.status(400).json({ message: 'message is required' });
    }
    if (req.user.role !== 'professor' && req.user.role !== 'admin' && req.user._id.toString() !== userId) {
      return res.status(403).json({ message: 'Access denied for this userId' });
    }

    const doc = await StudentData.findOne({ userId }).lean();
    const subjects = (req.body.studentData?.subjects || doc?.subjects || []).map(normalizeSubject);
    const history = chatHistoryStore.get(userId) || [];
    const trimmedHistory = history.slice(-8);
    const systemPrompt = [
      'You are an AI academic mentor. Answer any question. If academic, use student data. Otherwise respond normally.',
      'Be concise, practical, and personalized when data is relevant.',
      `Student subject data: ${JSON.stringify(subjects)}`,
      `Conversation history: ${JSON.stringify(trimmedHistory)}`,
      `Current user message: ${message}`,
    ].join('\n');

    const geminiText = await askGemini(systemPrompt);
    const fallbackReplies = [
      'I can help with academics and general questions. Share your target grade and I will create a day-wise action plan.',
      'Tell me your weakest subject and available study hours, and I will generate a focused weekly strategy.',
      'I can answer both academic and general queries. For academics, I can personalize advice using your current subject data.',
    ];
    const fallbackIndex = Math.abs(
      message.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
    ) % fallbackReplies.length;
    const aiText = geminiText || fallbackReplies[fallbackIndex];

    const nextHistory = [...trimmedHistory, { role: 'user', content: message }, { role: 'assistant', content: aiText }];
    chatHistoryStore.set(userId, nextHistory.slice(-16));

    return res.json({
      reply: aiText,
      history: nextHistory.slice(-16),
      source: geminiText ? 'gemini' : 'local',
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'AI chat failed' });
  }
}

router.post('/', authMiddleware, analyzeHandler);
router.post('/analyze', authMiddleware, analyzeHandler);
router.post('/subject-analysis', authMiddleware, subjectAnalysisHandler);
router.post('/overall', authMiddleware, overallHandler);
router.post('/chat', authMiddleware, chatHandler);

module.exports = router;

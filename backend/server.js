const path = require('path');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const StudentData = require('./models/StudentData');
const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const aiRoutes = require('./routes/ai');

// Default 5050: macOS often binds 5000 to AirPlay Receiver (Control Center), causing EADDRINUSE.
const PORT = Number(process.env.PORT) || 5050;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/studentDB';

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/ai', aiRoutes);

app.use(express.static(path.join(__dirname, '../frontend')));

const SUBJECTS = [
  'Enterprise Cloud Engineering',
  'Software Engineering',
  'Compiler Design',
  'Natural Language Processing',
  'Data Science',
  'Waste to Wealth',
];

function gradeFromScore(score) {
  if (score >= 90) return 'O';
  if (score >= 80) return 'A+';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B+';
  if (score >= 50) return 'B';
  return 'C';
}

function makeSubject(name, attendance, internalMarks, predictedExternalScore) {
  const totalScore = Math.max(0, Math.min(100, internalMarks + predictedExternalScore));
  return {
    name,
    attendance,
    internalMarks,
    predictedExternalScore,
    totalScore,
    marks: totalScore,
  };
}

function profileSubjects(profile) {
  if (profile === 'strong') {
    return [
      makeSubject(SUBJECTS[0], 96, 56, 35),
      makeSubject(SUBJECTS[1], 94, 55, 34),
      makeSubject(SUBJECTS[2], 88, 51, 31),
      makeSubject(SUBJECTS[3], 97, 58, 37),
      makeSubject(SUBJECTS[4], 95, 57, 36),
      makeSubject(SUBJECTS[5], 92, 53, 33),
    ];
  }
  if (profile === 'weak') {
    return [
      makeSubject(SUBJECTS[0], 74, 34, 20),
      makeSubject(SUBJECTS[1], 78, 38, 22),
      makeSubject(SUBJECTS[2], 71, 29, 17),
      makeSubject(SUBJECTS[3], 76, 35, 21),
      makeSubject(SUBJECTS[4], 80, 39, 23),
      makeSubject(SUBJECTS[5], 73, 33, 19),
    ];
  }
  return [
    makeSubject(SUBJECTS[0], 84, 46, 28),
    makeSubject(SUBJECTS[1], 82, 44, 26),
    makeSubject(SUBJECTS[2], 76, 39, 22),
    makeSubject(SUBJECTS[3], 86, 48, 29),
    makeSubject(SUBJECTS[4], 88, 49, 31),
    makeSubject(SUBJECTS[5], 81, 43, 25),
  ];
}

function summarize(subjects) {
  const avgAttendance = subjects.reduce((sum, s) => sum + Number(s.attendance || 0), 0) / subjects.length;
  const avgMarks = subjects.reduce((sum, s) => sum + Number(s.totalScore || 0), 0) / subjects.length;
  const score = (avgAttendance + avgMarks) / 2;
  return {
    avgAttendance: Number(avgAttendance.toFixed(2)),
    avgMarks: Number(avgMarks.toFixed(2)),
    predictedGrade: gradeFromScore(score),
  };
}

async function upsertStudentSeed({ name, email, role, profile, studentCode }) {
  const passwordHash = await bcrypt.hash('student123', 10);
  const user = await User.findOneAndUpdate(
    { email },
    {
      $set: {
        name,
        email,
        role,
        password: passwordHash,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  const subjects = profileSubjects(profile);
  const stats = summarize(subjects);

  const existingForUser = await StudentData.findOne({ userId: user._id }).lean();
  let finalStudentCode = existingForUser?.studentCode || studentCode;
  if (!existingForUser?.studentCode) {
    const collision = await StudentData.findOne({ studentCode: finalStudentCode }).lean();
    if (collision && String(collision.userId) !== String(user._id)) {
      for (let i = 1; i <= 999; i += 1) {
        const candidate = `S${String(i).padStart(3, '0')}`;
        const taken = await StudentData.findOne({ studentCode: candidate }).lean();
        if (!taken || String(taken.userId) === String(user._id)) {
          finalStudentCode = candidate;
          break;
        }
      }
    }
  }

  await StudentData.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        studentCode: finalStudentCode,
        attendance: stats.avgAttendance,
        internalMarks: stats.avgMarks,
        previousGrade: stats.predictedGrade,
        predictedGrade: stats.predictedGrade,
        subjects,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

async function seedProfessor() {
  const email = 'professor@studentpredictor.com';
  const exists = await User.findOne({ email });
  if (!exists) {
    const hashed = await bcrypt.hash('prof123', 10);
    await User.create({
      name: 'Professor',
      email,
      password: hashed,
      role: 'professor',
    });
    console.log('Seeded default professor:', email, '/ password: prof123');
  }
}

async function seedDemoStudents() {
  const seeds = [
    {
      name: 'Harish Putrevu',
      email: 'harish@srm.edu',
      role: 'student',
      profile: 'strong',
      studentCode: 'S001',
    },
    {
      name: 'Aarav Sharma',
      email: 'aarav@srm.edu',
      role: 'student',
      profile: 'average',
      studentCode: 'S002',
    },
    {
      name: 'Priya Reddy',
      email: 'priya@srm.edu',
      role: 'student',
      profile: 'weak',
      studentCode: 'S003',
    },
  ];

  for (const seed of seeds) {
    // Keep this deterministic so demos are repeatable.
    await upsertStudentSeed(seed);
  }
  console.log('Seeded demo students (password: student123 for all)');
}

mongoose
  .connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected:', MONGO_URI);
    await seedProfessor();
    await seedDemoStudents();
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`Open the app: http://localhost:${PORT}/login.html`);
      console.log('API base: http://localhost:' + PORT + '/api');
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `\nPort ${PORT} is already in use. On macOS, port 5000 is often taken by AirPlay Receiver.\n` +
            `Try: PORT=5051 npm start   (or disable AirPlay Receiver in System Settings → General → AirDrop & Handoff)\n`
        );
      } else {
        console.error(err);
      }
      process.exit(1);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed:', err.message);
    process.exit(1);
  });

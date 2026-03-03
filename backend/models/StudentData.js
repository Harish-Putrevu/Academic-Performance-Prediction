const mongoose = require('mongoose');

const subjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    attendance: { type: Number, required: true, min: 0, max: 100 },
    internalMarks: { type: Number, required: true, min: 0, max: 60 },
    predictedExternalScore: { type: Number, required: true, min: 0, max: 40 },
    totalScore: { type: Number, required: true, min: 0, max: 100 },
    // Backward-compatible alias used by older UI paths.
    marks: { type: Number, min: 0, max: 100 },
  },
  { _id: false }
);

const studentDataSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    studentCode: { type: String, unique: true, sparse: true },
    attendance: { type: Number, required: true, min: 0, max: 100 },
    internalMarks: { type: Number, required: true, min: 0, max: 100 },
    previousGrade: { type: String, required: true },
    predictedGrade: { type: String, required: true },
    subjects: [subjectSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('StudentData', studentDataSchema);

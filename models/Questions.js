const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  question: String,
  difficulty: String,
});

const Question = mongoose.model("Question", questionSchema);

module.exports = Question;

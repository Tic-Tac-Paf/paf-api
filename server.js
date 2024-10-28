const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const mongoose = require("mongoose");
const User = require("./models/User");
const Room = require("./models/Room");
const Questions = require("./models/Questions");
const dotenv = require("dotenv");
const { generateRoomCode } = require("./utils/data");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
dotenv.config();

// Connect to MongoDB
mongoose
  .connect(process.env.MONGO_DB, {
    dbName: "TikTakPaf",
  })
  .then(() => {
    console.log("Connected to MongoDB");
  });

const PORT = process.env.PORT || 3000;

let activeTimers = {}; // To track active timers per room

function startTimer(roomCode) {
  let timeLeft = 15;

  const timer = setInterval(async () => {
    if (timeLeft > 0) {
      // Broadcast the remaining time
      broadcastData("timerUpdate", { roomCode, timeLeft });
      timeLeft -= 1;
    } else {
      // Timer expired
      clearInterval(timer);
      activeTimers[roomCode] = null;

      // Set timeoutExpired flag in the room document
      const room = await Room.findOneAndUpdate(
        { code: roomCode },
        { $set: { timeoutExpired: true } },
        { new: true }
      );

      // Broadcast the round timeout event to all clients in the room
      // broadcastData("roundTimeout", { roomCode });
      broadcast({ room, type: "roundTimeout" });

      console.log(`Timer expired for room: ${roomCode}`);
    }
  }, 1000);

  // Save the timer to stop it if needed
  activeTimers[roomCode] = timer;
}

wss.on("connection", (ws) => {
  ws.on("message", async (message) => {
    const data = JSON.parse(message);

    switch (data.type) {
      case "createRoom":
        let user = await User.findOne({ id: data.playerId });
        if (!user) {
          user = new User({ username: data.username });
          await user.save();
        }

        try {
          const roomCode = generateRoomCode();

          const newRoom = new Room({
            code: roomCode,
            admin: { id: user.id, username: user.username },
            gameMode: data.gameMode,
            players: [],
          });
          await newRoom.save();

          ws.send(
            JSON.stringify({
              type: "roomCreated",
              room: newRoom,
              playerId: user.id,
            })
          );

          // broadcast({
          //   room: newRoom,
          //   data: { playerId: user.id },
          //   type: "roomCreated",
          // });
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }

        break;

      case "joinRoom":
        let joinUser = await User.findOne({ id: data.playerId });
        if (!joinUser) {
          joinUser = new User({ username: data.username });
          await joinUser.save();
        } else {
          joinUser.username = data.username;
          await joinUser.save();
        }

        const room = await Room.findOne({ code: data.roomCode });
        if (room) {
          try {
            if (!room.players.find((player) => player.id === joinUser.id)) {
              room.players.push({
                id: joinUser.id,
                username: joinUser.username,
              });
            } else {
              // replace the username with the new username
              room.players = room.players.map((player) => {
                if (player.id === joinUser.id) {
                  player.username = joinUser.username;
                }
                return player;
              });
            }

            await room.save();

            broadcastData("userJoinedRoom", { room, playerId: joinUser.id });

            // ws.send(
            //   JSON.stringify({
            //     type: "roomJoined",
            //     room,
            //     playerId: joinUser.id,
            //   })
            // );
          } catch (error) {
            ws.send(JSON.stringify({ type: "error", message: error.message }));
          }
        } else {
          ws.send(JSON.stringify({ type: "roomNotFound" }));
        }
        break;

      case "getRoomInfo":
        try {
          const roomInfo = await Room.findOne({ code: data.roomCode });
          if (roomInfo) {
            ws.send(
              JSON.stringify({
                type: "roomInfo",
                room: roomInfo,
              })
            );
          } else {
            ws.send(JSON.stringify({ type: "roomNotFound" }));
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }
        break;

      case "updateRoomInfo":
        try {
          const updateRoom = await Room.findOne({
            code: data.roomCode,
          });

          if (updateRoom.admin.id !== data.adminId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          const allowedKeys = ["gameMode", "difficulty", "rounds", "questions"];

          if (updateRoom) {
            if (allowedKeys.includes(data.key)) {
              if (data.key === "questions") {
                // data value must be an array of ObjectIds
                const questions = data.value.map((questionId) => {
                  return new mongoose.Types.ObjectId(questionId);
                });

                updateRoom[data.key] = questions;
              } else {
                updateRoom[data.key] = data.value;
              }
            }

            await updateRoom.save();

            const question = await Promise.all(
              updateRoom.questions.map((questionId) => {
                return Questions.findOne({ _id: questionId });
              })
            );

            broadcast({
              room: { ...updateRoom._doc, questions: question },
              type: "updatedRoom",
            });
          }
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }

        break;

      case "getQuestionsForRoom":
        try {
          const room = await Room.findOne({ code: data.roomCode });

          if (!room) {
            ws.send(JSON.stringify({ type: "roomNotFound" }));
            return;
          }

          if (room.admin.id !== data.adminId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          // Fetch questions with the specified difficulty
          const questions = await Questions.find({
            difficulty: room.difficulty,
            gameMode: room.gameMode,
          });

          // create 3 arrays with 3 questions each
          const questionSets = [];

          for (let i = 0; i < room.rounds; i++) {
            const set = [];
            for (let j = 0; j < 3; j++) {
              // max index is the length of the questions array
              const randomIndex = Math.floor(Math.random() * questions.length);

              console.log("Random index", randomIndex);

              // Extract only the fields we need
              let question = {
                _id: questions[randomIndex]._id,
                question: questions[randomIndex].question,
              };

              if (room.gameMode === "findWord") {
                question.answer = questions[randomIndex].answer;
              }

              set.push(question);

              // Remove the selected question to avoid duplicates
              questions.splice(randomIndex, 1);
            }
            questionSets.push(set);
          }

          ws.send(
            JSON.stringify({
              type: "questions",
              questions: questionSets,
              roomCode: room.code,
            })
          );
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }

        break;

      case "sendWord":
        const playerWord = data.word;
        try {
          const room = await Room.findOne({ code: data.roomCode });

          if (!room) {
            ws.send(JSON.stringify({ type: "roomNotFound" }));
            return;
          }

          if (room.timeoutExpired) {
            ws.send(
              JSON.stringify({ type: "roundTimeout", message: "Time is up!" })
            );
            return;
          }

          const player = await User.findOne({ id: data.playerId });
          if (!player) {
            ws.send(JSON.stringify({ type: "playerNotFound" }));
            return;
          }

          const currentRound = room.currentRound || 1;
          const responseTime = Date.now() - room.roundStartTime; // Calculate response time in milliseconds

          // Store word and response time without awarding points yet
          if (!room.words[`round_${currentRound}`]) {
            room.words[`round_${currentRound}`] = {};
          }

          room.words = {
            [`round_${currentRound}`]: {
              ...room.words[`round_${currentRound}`],
              [`${data.playerId}`]: {
                word: playerWord,
                responseTime,
              },
            },
          };

          await room.save();
          ws.send(JSON.stringify({ type: "wordSent" }));

          broadcast({ room });
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }
        break;

      case "getRoundResults":
        try {
          const room = await Room.findOne({ code: data.roomCode });

          if (!room) {
            ws.send(JSON.stringify({ type: "roomNotFound" }));
            return;
          }

          if (room.admin.id !== data.adminId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          const currentRound = room.currentRound || 1;

          // if (!room.words[`round_${currentRound}`]) {
          //   ws.send(JSON.stringify({ type: "noWords" }));
          //   return;
          // }

          const words = room?.words[`round_${currentRound}`] || {};
          const roomPlayers = room.players.map((player) => player.id);

          const playerData = await Promise.all(
            roomPlayers.map((playerId) => {
              return User.findOne({ id: playerId });
            })
          );

          const results =
            playerData.map((player) => {
              return {
                playerId: player.id,
                username: player.username,
                word: words[player.id] ? words[player.id].word : "",
              };
            }) || [];

          const question = await Questions.findOne({
            _id: room.questions[currentRound - 1],
          });

          ws.send(JSON.stringify({ type: "roundResults", results, question }));
        } catch (error) {
          console.log(error);

          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }
        break;

      case "startGame":
        try {
          const room = await Room.findOne({
            code: data.roomCode,
          });

          if (room.admin.id !== data.adminId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          if (room.gameState !== "lobby") {
            ws.send(JSON.stringify({ type: "gameAlreadyStarted" }));
            return;
          }

          room.gameState = "in_game";
          room.currentRound = 1;
          room.timeoutExpired = false; // Initialize the flag
          room.roundStartTime = Date.now(); // Track round start time

          await room.save();

          const question = await Questions.findOne({
            _id: room.questions[0],
          });

          broadcast({ room, type: "gameStarted" });
          broadcastData("roomQuestion", {
            question: {
              _id: question._id,
              question: question.question,
            },
            roomCode: room.code,
          });

          // Start a 15-second timer for the first round
          if (activeTimers[room.code]) clearInterval(activeTimers[room.code]); // Clear any existing timer
          startTimer(room.code);
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
        break;

      case "nextRound":
        try {
          const room = await Room.findOne({ code: data.roomCode });

          if (room.admin.id !== data.adminId) {
            ws.send(JSON.stringify({ type: "notAdmin" }));
            return;
          }

          if (room.currentRound === room.rounds) {
            room.gameState = "game_over";
            await room.save();
            broadcast({ room, type: "gameOver" });
            return;
          }

          if (room.gameState !== "in_game") {
            ws.send(JSON.stringify({ type: "gameNotStarted" }));
            return;
          }

          const question = await Questions.findOne({
            _id: room.questions[room.currentRound],
          });

          room.currentRound += 1;
          room.timeoutExpired = false; // Reset flag for new round
          await room.save();

          broadcast({ room, type: "nextRound" });
          broadcastData("roomQuestion", {
            question: {
              _id: question._id,
              question: question.question,
            },
            roomCode: room.code,
          });

          // Start a 15-second timer for the new round
          if (activeTimers[room.code]) clearInterval(activeTimers[room.code]); // Clear any existing timer
          startTimer(room.code);
        } catch (err) {
          ws.send(JSON.stringify({ type: "error", message: err.message }));
        }
        break;

      case "validateWord":
        const {
          validated: isWordValidated,
          adminId,
          playerId,
          roomCode,
        } = data;

        try {
          const room = await Room.findOne({ code: roomCode });
          if (!room) return ws.send(JSON.stringify({ type: "roomNotFound" }));
          if (room.admin.id !== adminId)
            return ws.send(JSON.stringify({ type: "notAdmin" }));

          const currentRound = room.currentRound || 1;
          const playerEntry = room.words[`round_${currentRound}`][playerId];

          if (playerEntry.validated) {
            return ws.send(JSON.stringify({ type: "wordAlreadyValidated" }));
          }

          let pointsAwarded = 10; // Base points
          if (isWordValidated) {
            const validatedEntries = Object.values(
              room.words[`round_${currentRound}`]
            )
              .filter((entry) => entry.validated)
              .sort((a, b) => a.responseTime - b.responseTime);

            const position =
              validatedEntries.findIndex((entry) => entry === playerEntry) + 1;

            if (position === 1) {
              pointsAwarded += 5;
            } else if (position === 2) {
              pointsAwarded += 3;
            } else if (position === 3) {
              pointsAwarded += 1;
            }
          }

          const updatedRoom = await Room.findOneAndUpdate(
            { code: roomCode, "players.id": playerId },
            {
              $set: {
                [`words.round_${currentRound}.${playerId}.validated`]:
                  isWordValidated,
              },
              ...(isWordValidated && {
                $inc: { "players.$[elem].points": pointsAwarded },
              }),
            },
            { new: true, arrayFilters: [{ "elem.id": playerId }] }
          );

          const results = updatedRoom.players.map((player) => ({
            playerId: player.id,
            username: player.username,
            word: updatedRoom.words?.[`round_${currentRound}`]?.[player.id]
              ?.word,
            validated:
              updatedRoom.words?.[`round_${currentRound}`]?.[player.id]
                ?.validated,
            responseTime:
              updatedRoom.words?.[`round_${currentRound}`]?.[player.id]
                ?.responseTime,
          }));

          ws.send(JSON.stringify({ type: "wordValidated", results }));
          broadcast({ room: updatedRoom });
        } catch (error) {
          ws.send(JSON.stringify({ type: "error", message: error.message }));
        }
        break;

      default:
        ws.send(JSON.stringify({ type: "unknownCommand" }));
        break;
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

function broadcastData(type, data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type, ...data }));
    }
  });
}

function broadcast({ room, data = {}, type = "broadcast" }) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: type, room, data }));
    }
  });
}

app.get("/", (req, res) => {
  res.send("Welcome to TikTakPaf");
});

server.listen(PORT, () => {
  console.log("Server is listening on port 3000");
});

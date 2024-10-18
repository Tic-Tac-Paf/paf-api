function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const numbers = "0123456789";
  let code = "";

  for (let i = 0; i < 3; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
    code += numbers.charAt(Math.floor(Math.random() * numbers.length));
  }

  // Shuffle the code to ensure a mix of letters and numbers
  code = code
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");

  return code;
}

module.exports = {
  generateRoomCode,
};

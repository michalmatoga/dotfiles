(async function main() {
  let data = "";

  process.stdin.on("data", (chunk) => {
    data += chunk; // Append chunk to data
  });

  process.stdin.on("end", () => {
    console.log({ data });
  });
})();

async function main() {
  const resp = await fetch('http://127.0.0.1:3001/internal/kameleo/profiles');
  const data = await resp.json();
  console.log(JSON.stringify(data, null, 2));
}
main();

import('./backend/server.js').catch((err) => {
  console.error(err)
  process.exit(1)
})

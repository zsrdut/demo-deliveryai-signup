const { createServer } = require('./src/app');

const port = Number(process.env.PORT || 3200);
createServer().listen(port, () => {
  console.log(`demo-deliveryai-signup listening on http://localhost:${port}`);
});

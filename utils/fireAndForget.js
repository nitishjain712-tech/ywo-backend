exports.fireAndForget = (task) => {
  setImmediate(async () => {
    try {
      await task();
    } catch (err) {
      console.error("🔥 Background task failed:", err.message);
    }
  });
};

// Console-only access log, scoped to the NivaBupa mount points.
//
// The ONDC project logged every request into MySQL keyed by the Beckn `context`
// envelope — none of which exists here, so requests are logged to stdout. Kept
// separate from tf-api's pino-http logger on purpose: the NivaBupa router is
// mounted before it (so the pass-throughs keep the exact middleware chain they
// had as a standalone service), and each NivaBupa call already logs its own
// payload detail from the service layer. This just frames them with
// method/path/status/duration.
const logRequest = (req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${durationMs}ms)`);
  });

  next();
};

export { logRequest };

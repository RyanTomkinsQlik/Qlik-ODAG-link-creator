export const config = {
  qlikHost: 'win-7cu4ono2k4r',  // Your server hostname
  qrsPort: 4242,                // Repository Service API
  enginePort: 4747,             // Engine API
  odagPort: 9098,               // ODAG Service API (corrected to 9098)
  certsPath: 'C:/certs',
  
  // Authentication settings
  userDirectory: 'win-7cu4ono2k4r',
  userId: 'qlik_svc',
  
  // Virtual proxy (empty for default)
  virtualProxy: '',
  
  // Service configuration
  servicePort: 3000,
  logLevel: 'debug',  // Changed to debug for troubleshooting
  
  // SSL settings
  rejectUnauthorized: true,
  
  // Timeouts
  requestTimeout: 30000,
  maxRetries: 3,
  retryDelay: 1000
};
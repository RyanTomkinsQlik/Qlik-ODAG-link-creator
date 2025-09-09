# ODAG Link Creator - Deployment Guide

## Overview

The ODAG Link Creator is a Node.js web service that provides a user-friendly interface for creating Qlik Sense On-Demand App Generation (ODAG) links. It creates ODAG links via the QRS API and automatically registers them in the Qlik Sense Hub using the Engine API.

## Features

- Web-based interface for ODAG link creation
- Automatic ODAG link creation via Qlik Sense QRS API
- Navigation object creation via Qlik Sense Engine API
- Windows service deployment with auto-start
- Advanced configuration options (row limits, retention, naming templates)
- Cross-platform browser auto-opening for development

## Prerequisites

### System Requirements
- **Windows Server** (tested on Windows Server environments)
- **Node.js v16+** (v18+ recommended)
- **npm** (comes with Node.js)
- **Administrator privileges** for service installation

### Qlik Sense Requirements
- **Qlik Sense Enterprise on Windows**
- **ODAG service enabled** on Qlik Sense server
- **Client certificates** exported from Qlik Management Console
- **Service account** with appropriate permissions

## Installation

### 1. Prepare the Server

1. **Install Node.js**
   - Download from https://nodejs.org/
   - Install the LTS version
   - Verify installation: `node --version`

2. **Create application directory**
   ```batch
   mkdir C:\QlikODAGService
   cd C:\QlikODAGService
   ```

### 2. Deploy Application Files

Copy the following files to `C:\QlikODAGService\`:

**Core Application Files:**
- `odag-link-creator.js` - Main application
- `config.js` - Configuration file
- `package.json` - Node.js dependencies

**Service Files:**
- `service-wrapper.cjs` - Service wrapper for PM2
- `pm2-setup.bat` - Service installation script

**Optional Management Files:**
- `remove-service-manual.bat` - Service removal script
- `create-service-manual.bat` - Alternative manual service creation

### 3. Install Node.js Dependencies

```batch
cd C:\QlikODAGService
npm install
```

**Required Node Modules** (automatically installed):
```json
{
  "dependencies": {
    "express": "^4.18.x",
    "axios": "^1.4.x",
    "ws": "^8.13.x",
    "uuid": "^9.0.x"
  },
  "type": "module"
}
```

### 4. Configure Qlik Sense Authentication

#### 4.1 Export Certificates from Qlik Management Console

1. Open **Qlik Management Console (QMC)**
2. Navigate to **Certificates**
3. Export certificates for your service account
4. Create certificate directory: `mkdir C:\certs`
5. Place the following files in `C:\certs\`:
   - `client.pem` - Client certificate
   - `client_key.pem` - Private key
   - `root.pem` - Root CA certificate

#### 4.2 Configure Service Account

1. In **QMC → Users**, verify your service account exists
2. Ensure the account has appropriate roles:
   - `RootAdmin` (full access) OR
   - `ContentAdmin` + ODAG permissions

### 5. Configure Application Settings

Edit `config.js` with your environment-specific settings:

```javascript
export const config = {
  // Server connection details
  qlikHost: 'your-qlik-server.domain.com',  // CHANGE THIS
  qrsPort: 4242,                             // Repository Service port
  enginePort: 4747,                          // Engine API port  
  odagPort: 9098,                           // ODAG service port
  
  // Certificate paths
  certsPath: 'C:/certs',                    // Certificate directory
  
  // Authentication settings  
  userDirectory: 'YOURDOMAIN',              // CHANGE THIS
  userId: 'service_account',                // CHANGE THIS
  
  // Virtual proxy (if using custom authentication)
  virtualProxy: '',                         // Leave empty for default
  
  // Service settings
  servicePort: 3000,                        // Web interface port
  rejectUnauthorized: true,                 // SSL verification
  
  // Timeouts
  requestTimeout: 30000,
  maxRetries: 3,
  retryDelay: 1000
};
```

**Critical Configuration Items to Change:**
- `qlikHost` - Your Qlik Sense server hostname
- `userDirectory` - Your domain/user directory (case sensitive)
- `userId` - Service account username (case sensitive)

### 6. Install as Windows Service

**Using PM2 (Recommended):**

1. **Run the PM2 setup script as Administrator**
   ```batch
   # Right-click and "Run as administrator"
   pm2-setup.bat
   ```

**Manual Service Creation (Alternative):**

1. **Run the manual setup script as Administrator**
   ```batch
   # Right-click and "Run as administrator"
   create-service-manual.bat
   ```

### 7. Verify Installation

1. **Check service status**
   ```batch
   # For PM2:
   pm2 status
   
   # For manual service:
   sc query "QlikODAGService"
   ```

2. **Test web interface**
   - Open browser to `http://localhost:3000`
   - Should display ODAG Link Creator interface

3. **Test ODAG functionality**
   - Use the web form to create a test ODAG link
   - Verify link appears in Qlik Sense Hub

## Configuration Options

### Environment Variables

The application recognizes these environment variables:

- `NODE_ENV=production` - Enables service mode (disables browser auto-open)
- `PORT=3000` - Web interface port

### Advanced Configuration

**Row Estimation Limits:**
```javascript
rowEstRange: [{
  context: "User_*",
  lowBound: 1,
  highBound: 500000  // Adjust based on your data size
}]
```

**App Retention Settings:**
```javascript
appRetentionTime: [{
  context: "User_*", 
  minutes: 10080  // 7 days (adjust as needed)
}]
```

**Generated App Naming:**
```javascript
genAppName: [{
  context: "User_*",
  formatString: "Generated App - $(user.name) - $(=Now())"
}]
```

## Service Management

### PM2 Commands
```batch
pm2 status                    # Check service status
pm2 logs odag-service        # View logs
pm2 restart odag-service     # Restart service
pm2 stop odag-service        # Stop service
pm2 delete odag-service      # Remove from PM2
```

### Windows Service Commands
```batch
sc query "QlikODAGService"    # Check status
sc start "QlikODAGService"    # Start service
sc stop "QlikODAGService"     # Stop service
sc delete "QlikODAGService"   # Remove service
```

### Viewing Logs

**PM2 Logs:**
```batch
pm2 logs odag-service --lines 100
```

**Windows Event Viewer:**
- Open `eventvwr.msc`
- Navigate to Windows Logs > Application
- Look for Node.js or service-related entries

## Troubleshooting

### Common Issues

**1. Certificate Authentication Errors**
- Verify certificates are in correct location (`C:\certs\`)
- Ensure certificates are readable by service account
- Check certificate file permissions

**2. Service Account Permission Issues**
- Verify user directory and user ID are exactly correct (case sensitive)
- Ensure service account has ODAG permissions in QMC
- Check Qlik Sense security rules

**3. ODAG Service Not Found (405 errors)**
- Verify ODAG service is running in Qlik Sense services
- Check if port 9098 is accessible
- Ensure ODAG is enabled in QMC

**4. Web Interface Not Accessible**
- Check if port 3000 is blocked by firewall
- Verify service is running: `pm2 status` or `sc query`
- Check service logs for startup errors

**5. Navigation Links Not Appearing in Hub**
- Verify Engine API connectivity (port 4747)
- Check WebSocket connections in logs
- Ensure user has app edit permissions

### Debug Mode

Run in development mode for detailed logging:
```batch
# Stop service first
pm2 stop odag-service

# Run manually with debug output
set NODE_ENV=development
node odag-link-creator.js
```

## Security Considerations

1. **Certificate Security**
   - Store certificates in secure location
   - Limit file system permissions to service account only
   - Regularly rotate certificates per your security policy

2. **Network Security**
   - Consider firewall rules for port 3000
   - Use HTTPS if exposing to network (requires additional configuration)
   - Limit access to authorized users only

3. **Service Account**
   - Use dedicated service account with minimal required permissions
   - Regularly review and audit permissions
   - Follow your organization's service account policies

## Performance Tuning

**For high-volume usage:**

1. **Increase Node.js memory limit**
   ```javascript
   // In service configuration
   nodeOptions: ['--max_old_space_size=8192']  // 8GB
   ```

2. **Adjust timeout values**
   ```javascript
   // In config.js
   requestTimeout: 60000,  // Increase for slow networks
   ```

3. **Connection pooling**
   ```javascript
   // HTTPS agent settings
   maxSockets: 100,  // Increase concurrent connections
   ```

## API Usage

The service also provides REST API endpoints for programmatic access:

```bash
# Create ODAG link via API
POST http://localhost:3000/api/odag/create
Content-Type: application/json

{
  "selectionAppId": "app-guid-here",
  "templateAppId": "template-guid-here", 
  "linkName": "My ODAG Link",
  "rowEstExpr": "Sum(SALES)"
}

# Test connection
GET http://localhost:3000/api/odag/test-connection
```

## Support

**Log Files:**
- PM2 logs: `pm2 logs odag-service`
- Windows Event Viewer: Application logs
- Console output when running manually

**Configuration Validation:**
- Test Qlik Sense connectivity: `http://localhost:3000/api/odag/test-connection`
- Verify certificates and permissions
- Check all required services are running

**Common Commands for Troubleshooting:**
```batch
# Check Node.js installation
node --version
npm --version

# Verify certificates exist
dir C:\certs\

# Check Qlik Sense services
sc query | findstr /i "qlik"

# Test network connectivity
telnet your-qlik-server 4242
telnet your-qlik-server 9098
```

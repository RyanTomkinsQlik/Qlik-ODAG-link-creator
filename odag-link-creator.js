import fs from 'fs';
import https from 'https';
import axios from 'axios';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { exec } from 'child_process';
import express from 'express';

// Import configuration from separate config file
import { config } from './config.js';

class ODAGLinkCreator {
  constructor(config) {
    this.config = {
      qlikHost: config.qlikHost || 'localhost',
      qrsPort: config.qrsPort || 4242,
      enginePort: config.enginePort || 4747,
      odagPort: config.odagPort || 9098,
      certsPath: config.certsPath || 'C:/certs',
      userDirectory: config.userDirectory || 'win-7cu4ono2k4r',
      userId: config.userId || 'qlik_svc',
      virtualProxy: config.virtualProxy || '',
      ...config
    };

    this.httpsAgent = new https.Agent({
      cert: fs.readFileSync(`${this.config.certsPath}/client.pem`),
      key: fs.readFileSync(`${this.config.certsPath}/client_key.pem`),
      ca: fs.readFileSync(`${this.config.certsPath}/root.pem`),
      rejectUnauthorized: true,
      keepAlive: true,
      maxSockets: 50
    });

    this.xrfKey = this.generateXrfKey();

    this.axiosConfig = {
      httpsAgent: this.httpsAgent,
      headers: {
        'X-Qlik-Xrfkey': this.xrfKey,
        'X-Qlik-User': `UserDirectory=${this.config.userDirectory}; UserId=${this.config.userId}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    };

    this.authenticated = false;
  }

  generateXrfKey() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async authenticate() {
    try {
      console.log('Performing initial authentication...');
      
      const baseUrl = this.config.virtualProxy 
        ? `https://${this.config.qlikHost}:${this.config.qrsPort}/${this.config.virtualProxy}`
        : `https://${this.config.qlikHost}:${this.config.qrsPort}`;
      
      const authUrl = `${baseUrl}/qrs/about?xrfkey=${this.xrfKey}`;
      
      console.log(`Making initial auth request to: ${authUrl}`);
      const authResponse = await axios.get(authUrl, this.axiosConfig);
      
      if (authResponse.status === 200) {
        console.log('Initial authentication successful');
        console.log('Server info:', authResponse.data.buildVersion);
        this.authenticated = true;
        return true;
      }
      
    } catch (error) {
      console.error('Authentication failed:', error.message);
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  async ensureAuthenticated() {
    if (!this.authenticated) {
      await this.authenticate();
    }
  }

  async validateAppId(appId) {
    try {
      await this.ensureAuthenticated();
      
      const baseUrl = this.config.virtualProxy 
        ? `https://${this.config.qlikHost}:${this.config.qrsPort}/${this.config.virtualProxy}`
        : `https://${this.config.qlikHost}:${this.config.qrsPort}`;
      
      const url = `${baseUrl}/qrs/app/${appId}?xrfkey=${this.xrfKey}`;
      
      console.log(`Validating app ID: ${appId}`);
      const response = await axios.get(url, this.axiosConfig);
      
      if (response.data && response.data.id) {
        console.log(`App found: ${response.data.name} (${response.data.id})`);
        return {
          valid: true,
          name: response.data.name,
          id: response.data.id,
          published: response.data.published
        };
      } else {
        throw new Error(`App not found: ${appId}`);
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`App ID not found: ${appId}`);
        return {
          valid: false,
          error: `App ID not found: ${appId}`
        };
      }
      console.error(`Failed to validate app ID ${appId}:`, error.message);
      throw new Error(`Failed to validate app ID ${appId}: ${error.message}`);
    }
  }

  async createODAGLink(linkConfig) {
    try {
      await this.ensureAuthenticated();
      
      const url = `https://${this.config.qlikHost}:${this.config.odagPort}/v1/links?xrfkey=${this.xrfKey}`;
      
      console.log(`Creating ODAG link: ${linkConfig.name}`);
      console.log(`Selection App: ${linkConfig.selectionAppId}`);
      console.log(`Template App: ${linkConfig.templateAppId}`);
      console.log(`Row Estimation Expression: ${linkConfig.rowEstExpr}`);
      console.log(`URL: ${url}`);
      
      const odagPayload = {
        name: linkConfig.name,
        selectionApp: linkConfig.selectionAppId,
        templateApp: linkConfig.templateAppId,
        rowEstExpr: linkConfig.rowEstExpr,
        properties: {
          rowEstRange: linkConfig.rowEstRange || [{ 
            context: 'User_*', 
            lowBound: 1, 
            highBound: 500000 
          }],
          appRetentionTime: linkConfig.appRetentionTime || [{ 
            context: 'User_*', 
            minutes: 10080
          }],
          genAppName: linkConfig.genAppName || [{ 
            context: 'User_*', 
            formatString: `${linkConfig.name} - $(user.name) - $(=Now())` 
          }]
        }
      };

      console.log('ODAG Payload:', JSON.stringify(odagPayload, null, 2));

      const response = await axios.post(url, odagPayload, this.axiosConfig);
      
      if (response.data && response.data.objectDef && response.data.objectDef.id) {
        console.log(`ODAG link created successfully: ${response.data.objectDef.id}`);
        return response.data.objectDef;
      } else if (response.data && response.data.id) {
        console.log(`ODAG link created successfully: ${response.data.id}`);
        return response.data;
      } else {
        throw new Error('Failed to create ODAG link - no ID returned');
      }
    } catch (error) {
      console.error('ODAG link creation failed:', error.response?.data || error.message);
      
      if (error.response) {
        const status = error.response.status;
        const data = error.response.data;
        
        switch (status) {
          case 400:
            throw new Error(`Bad Request: ${data?.message || 'Invalid ODAG configuration'}`);
          case 401:
            throw new Error('Unauthorized: Please check your authentication credentials');
          case 403:
            throw new Error('Forbidden: User may not have ODAG permissions');
          case 404:
            throw new Error('Not Found: ODAG service may not be running on port 9098');
          case 405:
            throw new Error('Method Not Allowed: Check ODAG service configuration and URL path');
          case 500:
            throw new Error(`Server Error: ${data?.message || 'Internal server error'}`);
          default:
            throw new Error(`HTTP ${status}: ${data?.message || error.message}`);
        }
      }
      
      throw new Error(`Failed to create ODAG link: ${error.message}`);
    }
  }

  async addNavigationLinkToApp(selectionAppId, odagLinkId, linkName, description = '') {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.virtualProxy
        ? `wss://${this.config.qlikHost}:${this.config.enginePort}/${this.config.virtualProxy}/app/${selectionAppId}`
        : `wss://${this.config.qlikHost}:${this.config.enginePort}/app/${selectionAppId}`;
      
      console.log(`Opening WebSocket connection to: ${wsUrl}`);
      
      const ws = new WebSocket(wsUrl, {
        headers: {
          'X-Qlik-Xrfkey': this.xrfKey,
          'X-Qlik-User': `UserDirectory=${this.config.userDirectory}; UserId=${this.config.userId}`
        },
        agent: this.httpsAgent,
        handshakeTimeout: 10000
      });

      let requestId = 1;
      const requests = new Map();
      let appHandle = null;

      const connectionTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 15000);

      ws.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection established');
        
        const openAppRequest = {
          handle: -1,
          method: 'OpenDoc',
          params: [selectionAppId],
          jsonrpc: '2.0',
          id: requestId
        };

        console.log('Opening app...');
        requests.set(requestId, 'openApp');
        ws.send(JSON.stringify(openAppRequest));
        requestId++;
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data);
          const requestType = requests.get(response.id);

          if (response.error) {
            console.error('WebSocket error:', response.error);
            ws.close();
            reject(new Error(`WebSocket error: ${response.error.message}`));
            return;
          }

          switch (requestType) {
            case 'openApp':
              appHandle = response.result.qReturn.qHandle;
              console.log(`App opened with handle: ${appHandle}`);
              
              const createObjectRequest = {
                handle: appHandle,
                method: 'CreateObject',
                params: {
                  qProp: {
                    qInfo: {
                      qType: 'odagapplink'
                    },
                    qMetaDef: {
                      odagLinkRef: odagLinkId
                    }
                  }
                },
                jsonrpc: '2.0',
                id: requestId
              };

              console.log('Creating ODAG app link object...');
              requests.set(requestId, 'createObject');
              ws.send(JSON.stringify(createObjectRequest));
              requestId++;
              break;

            case 'createObject':
              console.log('ODAG app link object created successfully');
              
              const saveRequest = {
                handle: appHandle,
                method: 'DoSave',
                params: [],
                jsonrpc: '2.0',
                id: requestId
              };

              console.log('Saving app...');
              requests.set(requestId, 'save');
              ws.send(JSON.stringify(saveRequest));
              requestId++;
              break;

            case 'save':
              console.log('App saved successfully');
              ws.close();
              resolve('ODAG app link created and app saved');
              break;
          }
        } catch (error) {
          console.error('Failed to parse WebSocket response:', error.message);
          ws.close();
          reject(new Error(`Failed to parse WebSocket response: ${error.message}`));
        }
      });

      ws.on('error', (error) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', error.message);
        reject(new Error(`WebSocket error: ${error.message}`));
      });

      ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        if (code !== 1000) {
          console.error(`WebSocket closed with code ${code}: ${reason}`);
          reject(new Error(`WebSocket closed with code ${code}: ${reason}`));
        }
      });
    });
  }

  async createCompleteODAGLink(options) {
    try {
      console.log('Starting ODAG link creation process...');
      console.log('Authentication context:', `${this.config.userDirectory}\\${this.config.userId}`);

      await this.ensureAuthenticated();

      const requiredFields = ['linkName', 'rowEstExpr'];
      const hasAppIds = options.selectionAppId && options.templateAppId;
      
      if (!hasAppIds) {
        throw new Error('Missing required fields: selectionAppId and templateAppId are required');
      }
      
      for (const field of requiredFields) {
        if (!options[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      console.log('Validating app IDs...');
      const selectionAppValidation = await this.validateAppId(options.selectionAppId);
      const templateAppValidation = await this.validateAppId(options.templateAppId);
      
      if (!selectionAppValidation.valid) {
        throw new Error(`Selection app validation failed: ${selectionAppValidation.error}`);
      }
      
      if (!templateAppValidation.valid) {
        throw new Error(`Template app validation failed: ${templateAppValidation.error}`);
      }
      
      console.log(`Selection App: ${selectionAppValidation.name} (${options.selectionAppId})`);
      console.log(`Template App: ${templateAppValidation.name} (${options.templateAppId})`);

      console.log('Creating ODAG link...');
      const linkConfig = {
        name: options.linkName,
        selectionAppId: options.selectionAppId,
        templateAppId: options.templateAppId,
        rowEstExpr: options.rowEstExpr,
        rowEstRange: options.rowEstRange,
        appRetentionTime: options.appRetentionTime,
        genAppName: options.genAppName
      };

      const odagLink = await this.createODAGLink(linkConfig);

      console.log('Adding navigation link to selection app...');
      try {
        await this.addNavigationLinkToApp(
          options.selectionAppId, 
          odagLink.id, 
          options.linkName,
          options.description || 'On-demand app generation link'
        );

        console.log('ODAG link creation completed successfully!');
        
        return {
          success: true,
          odagLinkId: odagLink.id,
          selectionAppId: options.selectionAppId,
          templateAppId: options.templateAppId,
          selectionAppName: selectionAppValidation.name,
          templateAppName: templateAppValidation.name,
          message: 'ODAG link created and registered in Hub successfully'
        };

      } catch (navError) {
        console.log('PARTIAL SUCCESS - ODAG link created but navigation link failed');
        
        return {
          success: true,
          partial: true,
          odagLinkId: odagLink.id,
          selectionAppId: options.selectionAppId,
          templateAppId: options.templateAppId,
          selectionAppName: selectionAppValidation.name,
          templateAppName: templateAppValidation.name,
          message: 'ODAG link created successfully. Navigation link must be added manually.',
          navigationLinkError: navError.message
        };
      }

    } catch (error) {
      console.error('ODAG link creation failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async testConnection() {
    try {
      console.log('Testing Qlik Sense connection...');
      
      await this.authenticate();
      console.log('QRS API: Connection working');
      
      try {
        const url = `https://${this.config.qlikHost}:${this.config.odagPort}/v1/links?xrfkey=${this.xrfKey}`;
        const response = await axios.get(url, this.axiosConfig);
        console.log('ODAG API: Connection working');
      } catch (odagError) {
        console.log('ODAG API: Connection failed -', odagError.message);
      }
      
      return {
        success: true,
        message: 'Connection test completed',
        qrsApi: 'working',
        authentication: 'successful'
      };
      
    } catch (error) {
      console.error('Connection test failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Create service instance
const odagService = new ODAGLinkCreator(config);

// Create Express app
const app = express();
app.use(express.json());

// Serve the HTML form
app.get('/', (req, res) => {
  const htmlForm = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ODAG Link Creator</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
        .container { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #2c3e50; text-align: center; margin-bottom: 30px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; color: #34495e; }
        input[type="text"], input[type="number"], textarea { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
        textarea { height: 60px; resize: vertical; }
        .row { display: flex; gap: 20px; }
        .col { flex: 1; }
        button { background-color: #3498db; color: white; padding: 12px 30px; border: none; border-radius: 4px; font-size: 16px; cursor: pointer; width: 100%; margin-top: 20px; }
        button:hover { background-color: #2980b9; }
        button:disabled { background-color: #bdc3c7; cursor: not-allowed; }
        .result { margin-top: 20px; padding: 15px; border-radius: 4px; display: none; }
        .success { background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .error { background-color: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .loading { text-align: center; color: #666; }
        .advanced { border: 1px solid #ddd; padding: 20px; margin-top: 20px; border-radius: 4px; background-color: #f9f9f9; }
        .advanced h3 { margin-top: 0; color: #2c3e50; }
    </style>
</head>
<body>
    <div class="container">
        <h1>ODAG Link Creator</h1>
        <form id="odagForm">
            <div class="form-group">
                <label for="linkName">Link Name *</label>
                <input type="text" id="linkName" name="linkName" required placeholder="e.g., Sales Detail Link">
            </div>
            <div class="row">
                <div class="col">
                    <div class="form-group">
                        <label for="selectionAppId">Selection App ID *</label>
                        <input type="text" id="selectionAppId" name="selectionAppId" required placeholder="e.g., 387139c2-c2d7-4442-8201-ec30307f8ab1">
                    </div>
                </div>
                <div class="col">
                    <div class="form-group">
                        <label for="templateAppId">Template App ID *</label>
                        <input type="text" id="templateAppId" name="templateAppId" required placeholder="e.g., 09338ae2-5727-4652-a911-a333a7a92766">
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label for="rowEstExpr">Row Estimation Expression *</label>
                <input type="text" id="rowEstExpr" name="rowEstExpr" required placeholder="e.g., Sum(FLIGHT_COUNT) or Count(DISTINCT [Order ID])">
            </div>
            <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" placeholder="Optional description for the ODAG link"></textarea>
            </div>
            <div class="advanced">
                <h3>Advanced Settings</h3>
                <div class="row">
                    <div class="col">
                        <div class="form-group">
                            <label for="maxRowCount">Max Row Count</label>
                            <input type="number" id="maxRowCount" name="maxRowCount" value="500000" placeholder="500000">
                        </div>
                    </div>
                    <div class="col">
                        <div class="form-group">
                            <label for="retentionDays">App Retention (Days)</label>
                            <input type="number" id="retentionDays" name="retentionDays" value="7" placeholder="7">
                        </div>
                    </div>
                </div>
                <div class="form-group">
                    <label for="genAppName">Generated App Name Template</label>
                    <input type="text" id="genAppName" name="genAppName" placeholder="e.g., Sales Detail - $(user.name) - $(=Now())" value="">
                </div>
            </div>
            <button type="submit" id="submitBtn">Create ODAG Link</button>
        </form>
        <div id="result" class="result"></div>
    </div>
    <script>
        document.getElementById('odagForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitBtn = document.getElementById('submitBtn');
            const resultDiv = document.getElementById('result');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating ODAG Link...';
            resultDiv.style.display = 'block';
            resultDiv.className = 'result loading';
            resultDiv.innerHTML = 'Creating ODAG link, please wait...';
            try {
                const formData = new FormData(e.target);
                const data = {
                    selectionAppId: formData.get('selectionAppId'),
                    templateAppId: formData.get('templateAppId'),
                    linkName: formData.get('linkName'),
                    description: formData.get('description'),
                    rowEstExpr: formData.get('rowEstExpr')
                };
                const maxRowCount = parseInt(formData.get('maxRowCount'));
                const retentionDays = parseInt(formData.get('retentionDays'));
                const genAppName = formData.get('genAppName');
                if (maxRowCount && maxRowCount > 0) {
                    data.rowEstRange = [{ context: "User_*", lowBound: 1, highBound: maxRowCount }];
                }
                if (retentionDays && retentionDays > 0) {
                    data.appRetentionTime = [{ context: "User_*", minutes: retentionDays * 24 * 60 }];
                }
                if (genAppName && genAppName.trim()) {
                    data.genAppName = [{ context: "User_*", formatString: genAppName }];
                }
                const response = await fetch('/api/odag/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await response.json();
                if (result.success) {
                    resultDiv.className = 'result success';
                    resultDiv.innerHTML = \`<h3>Success!</h3><p><strong>ODAG Link ID:</strong> \${result.odagLinkId}</p><p><strong>Selection App:</strong> \${result.selectionAppName}</p><p><strong>Template App:</strong> \${result.templateAppName}</p><p><strong>Status:</strong> \${result.message}</p>\${result.partial ? '<p><strong>Note:</strong> Manual navigation link setup may be required.</p>' : ''}\`;
                } else {
                    throw new Error(result.error || 'Unknown error occurred');
                }
            } catch (error) {
                resultDiv.className = 'result error';
                resultDiv.innerHTML = \`<h3>Error</h3><p>\${error.message}</p>\`;
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create ODAG Link';
            }
        });
    </script>
</body>
</html>`;
  res.send(htmlForm);
});

function openBrowser(url) {
  let command;
  switch (process.platform) {
    case 'win32':
      command = `start ${url}`;
      break;
    case 'darwin':
      command = `open ${url}`;
      break;
    case 'linux':
      command = `xdg-open ${url}`;
      break;
    default:
      console.log(`Please manually open: ${url}`);
      return;
  }
  
  exec(command, (error) => {
    if (error) {
      console.log(`Could not auto-open browser. Please manually open: ${url}`);
    } else {
      console.log(`Browser opened successfully!`);
    }
  });
}

app.get('/api/odag/test-connection', async (req, res) => {
  try {
    const result = await odagService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/odag/create', async (req, res) => {
  try {
    const result = await odagService.createCompleteODAGLink(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check if running as service
const isService = process.env.NODE_ENV === 'production' || process.argv.includes('--service');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ODAG Link Creator Service running on port ${PORT}`);
  console.log(`Ready to create ODAG links with authentication: ${config.userDirectory}\\${config.userId}`);
  console.log();
  console.log(`Web Interface: http://localhost:${PORT}`);
  console.log(`API Endpoint: http://localhost:${PORT}/api/odag/create`);
  console.log(`Platform: ${process.platform}`);
  
  if (isService) {
    console.log('Running as Windows service - browser auto-open disabled');
    console.log('Access the web interface manually at http://localhost:3000');
  } else {
    // Only auto-open browser when running interactively
    setTimeout(() => {
      const url = `http://localhost:${PORT}`;
      console.log(`Opening browser automatically...`);
      openBrowser(url);
    }, 2000);
  }
});

// Add graceful shutdown handling for service
process.on('SIGINT', () => {
  console.log('Received SIGINT. Graceful shutdown...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Graceful shutdown...');
  process.exit(0);
});

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

export { ODAGLinkCreator, odagService };
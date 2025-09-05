import fs from 'fs';
import https from 'https';
import axios from 'axios';
import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';

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
      // Authentication settings
      userDirectory: config.userDirectory || 'win-7cu4ono2k4r',
      userId: config.userId || 'qlik_svc',
      virtualProxy: config.virtualProxy || '', // Add virtual proxy support
      ...config
    };

    // Set up HTTPS agent with certificates
    this.httpsAgent = new https.Agent({
      cert: fs.readFileSync(`${this.config.certsPath}/client.pem`),
      key: fs.readFileSync(`${this.config.certsPath}/client_key.pem`),
      ca: fs.readFileSync(`${this.config.certsPath}/root.pem`),
      rejectUnauthorized: true,
      keepAlive: true,
      maxSockets: 50
    });

    // Generate XRF key once for the session
    this.xrfKey = this.generateXrfKey();

    this.axiosConfig = {
      httpsAgent: this.httpsAgent,
      headers: {
        'X-Qlik-Xrfkey': this.xrfKey,
        'X-Qlik-User': `UserDirectory=${this.config.userDirectory}; UserId=${this.config.userId}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000 // 30 second timeout
    };

    // Track authentication state
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

  // Authentication method to handle initial GET request
  async authenticate() {
    try {
      console.log('Performing initial authentication...');
      
      // Build base URL with virtual proxy if specified
      const baseUrl = this.config.virtualProxy 
        ? `https://${this.config.qlikHost}:${this.config.qrsPort}/${this.config.virtualProxy}`
        : `https://${this.config.qlikHost}:${this.config.qrsPort}`;
      
      // Step 1: Initial GET request to establish authentication
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
      
      // If 401/403, try alternative authentication approaches
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        return await this.tryAlternativeAuth();
      }
      
      throw new Error(`Authentication failed: ${error.message}`);
    }
  }

  // Alternative authentication methods
  async tryAlternativeAuth() {
    console.log('Trying alternative authentication methods...');
    
    const methods = [
      () => this.tryWindowsAuth(),
      () => this.tryHeaderAuth(),
      () => this.tryTicketAuth()
    ];

    for (const method of methods) {
      try {
        const result = await method();
        if (result) {
          this.authenticated = true;
          return true;
        }
      } catch (error) {
        console.log(`Auth method failed: ${error.message}`);
      }
    }

    return false;
  }

  async tryWindowsAuth() {
    console.log('Trying Windows authentication...');
    
    const authConfig = {
      ...this.axiosConfig,
      headers: {
        ...this.axiosConfig.headers,
        'Authorization': `NTLM ${Buffer.from(`${this.config.userDirectory}\\${this.config.userId}`).toString('base64')}`
      }
    };

    const url = `https://${this.config.qlikHost}:${this.config.qrsPort}/qrs/about?xrfkey=${this.xrfKey}`;
    const response = await axios.get(url, authConfig);
    return response.status === 200;
  }

  async tryHeaderAuth() {
    console.log('Trying header-based authentication...');
    
    const authConfig = {
      ...this.axiosConfig,
      headers: {
        ...this.axiosConfig.headers,
        'hdr-usr': this.config.userId,
        'hdr-usr-dir': this.config.userDirectory
      }
    };

    const url = `https://${this.config.qlikHost}:${this.config.qrsPort}/qrs/about?xrfkey=${this.xrfKey}`;
    const response = await axios.get(url, authConfig);
    return response.status === 200;
  }

  async tryTicketAuth() {
    console.log('Trying ticket-based authentication...');
    
    // Generate a simple ticket for testing
    const ticket = Buffer.from(`${this.config.userDirectory}\\${this.config.userId}`).toString('base64');
    
    const authConfig = {
      ...this.axiosConfig,
      headers: {
        ...this.axiosConfig.headers,
        'Authorization': `Bearer ${ticket}`
      }
    };

    const url = `https://${this.config.qlikHost}:${this.config.qrsPort}/qrs/about?xrfkey=${this.xrfKey}`;
    const response = await axios.get(url, authConfig);
    return response.status === 200;
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

  // Legacy method to get app ID by name (kept for backwards compatibility)
  async getAppIdByName(appName) {
    try {
      await this.ensureAuthenticated();
      
      const baseUrl = this.config.virtualProxy 
        ? `https://${this.config.qlikHost}:${this.config.qrsPort}/${this.config.virtualProxy}`
        : `https://${this.config.qlikHost}:${this.config.qrsPort}`;
      
      const url = `${baseUrl}/qrs/app?filter=name eq '${appName}'&xrfkey=${this.xrfKey}`;
      
      const response = await axios.get(url, this.axiosConfig);
      
      if (response.data && response.data.length > 0) {
        return response.data[0].id;
      } else {
        throw new Error(`App not found: ${appName}`);
      }
    } catch (error) {
      throw new Error(`Failed to get app ID for ${appName}: ${error.message}`);
    }
  }

  async createODAGLink(linkConfig) {
    try {
      await this.ensureAuthenticated();
      
      // For certificate authentication, use port 9098 with /v1/links path
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
            minutes: 10080 // 7 days
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
      
      // Provide more specific error handling
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

  // Add navigation link using proper Engine API CreateObject call
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

      // Add connection timeout
      const connectionTimeout = setTimeout(() => {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }, 15000);

      ws.on('open', () => {
        clearTimeout(connectionTimeout);
        console.log('WebSocket connection established');
        
        // First, open the app to get its handle
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
              
              // Create ODAG app link object using the correct Engine API call
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
              console.log('CreateObject payload:', JSON.stringify(createObjectRequest, null, 2));
              requests.set(requestId, 'createObject');
              ws.send(JSON.stringify(createObjectRequest));
              requestId++;
              break;

            case 'createObject':
              console.log('ODAG app link object created successfully');
              console.log('Object response:', JSON.stringify(response.result, null, 2));
              
              // Save the app
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

  // Master method - uses the correct Engine API approach
  async addNavigationLinkWithFallbacks(selectionAppId, odagLinkId, linkName, description = '') {
    console.log('Creating ODAG app link using Engine API CreateObject method...');
    
    try {
      const result = await this.addNavigationLinkToApp(selectionAppId, odagLinkId, linkName, description);
      console.log(`SUCCESS: ${result}`);
      return { success: true, method: 'CreateObject', result };
    } catch (error) {
      console.log(`CreateObject method failed: ${error.message}`);
      throw new Error(`Failed to create ODAG app link: ${error.message}`);
    }
  }

  async createCompleteODAGLink(options) {
    try {
      console.log('Starting ODAG link creation process...');
      console.log('Authentication context:', `${this.config.userDirectory}\\${this.config.userId}`);

      // Ensure authentication first
      await this.ensureAuthenticated();

      // Validate required options - support both app IDs and app names for backwards compatibility
      const requiredFields = ['linkName', 'rowEstExpr'];
      const hasAppIds = options.selectionAppId && options.templateAppId;
      const hasAppNames = options.selectionAppName && options.templateAppName;
      
      if (!hasAppIds && !hasAppNames) {
        throw new Error('Missing required fields: Either provide selectionAppId/templateAppId OR selectionAppName/templateAppName');
      }
      
      for (const field of requiredFields) {
        if (!options[field]) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      let selectionAppId, templateAppId;
      let selectionAppValidation, templateAppValidation;

      if (hasAppIds) {
        // Step 1: Validate app IDs exist
        console.log('Validating app IDs...');
        selectionAppValidation = await this.validateAppId(options.selectionAppId);
        templateAppValidation = await this.validateAppId(options.templateAppId);
        
        if (!selectionAppValidation.valid) {
          throw new Error(`Selection app validation failed: ${selectionAppValidation.error}`);
        }
        
        if (!templateAppValidation.valid) {
          throw new Error(`Template app validation failed: ${templateAppValidation.error}`);
        }
        
        selectionAppId = options.selectionAppId;
        templateAppId = options.templateAppId;
        
        console.log(`Selection App: ${selectionAppValidation.name} (${selectionAppId})`);
        console.log(`Template App: ${templateAppValidation.name} (${templateAppId})`);
        
      } else {
        // Legacy support: Get app IDs from names
        console.log('Getting app IDs from names...');
        selectionAppId = await this.getAppIdByName(options.selectionAppName);
        templateAppId = await this.getAppIdByName(options.templateAppName);
        
        console.log(`Selection App ID: ${selectionAppId}`);
        console.log(`Template App ID: ${templateAppId}`);
        
        // Create validation objects for consistent return format
        selectionAppValidation = { name: options.selectionAppName };
        templateAppValidation = { name: options.templateAppName };
      }

      // Step 2: Create ODAG link
      console.log('Creating ODAG link...');
      const linkConfig = {
        name: options.linkName,
        selectionAppId: selectionAppId,
        templateAppId: templateAppId,
        rowEstExpr: options.rowEstExpr,
        rowEstRange: options.rowEstRange,
        appRetentionTime: options.appRetentionTime,
        genAppName: options.genAppName
      };

      const odagLink = await this.createODAGLink(linkConfig);

      // Step 3: Add navigation link to selection app with fallbacks
      console.log('Adding navigation link to selection app...');
      try {
        const navResult = await this.addNavigationLinkWithFallbacks(
          selectionAppId, 
          odagLink.id, 
          options.linkName,
          options.description || 'On-demand app generation link'
        );

        console.log('ODAG link creation completed successfully!');
        
        return {
          success: true,
          odagLinkId: odagLink.id,
          selectionAppId: selectionAppId,
          templateAppId: templateAppId,
          selectionAppName: selectionAppValidation.name,
          templateAppName: templateAppValidation.name,
          navigationLinkMethod: navResult.method,
          message: 'ODAG link created and registered in Hub successfully'
        };

      } catch (navError) {
        console.log('PARTIAL SUCCESS - ODAG link created but navigation link failed');
        console.log('Manual step required: Add navigation link in Qlik Sense Hub');
        
        return {
          success: true,
          partial: true,
          odagLinkId: odagLink.id,
          selectionAppId: selectionAppId,
          templateAppId: templateAppId,
          selectionAppName: selectionAppValidation.name,
          templateAppName: templateAppValidation.name,
          message: 'ODAG link created successfully. Navigation link must be added manually.',
          navigationLinkError: navError.message,
          manualSteps: [
            '1. Open the selection app in Qlik Sense Hub',
            '2. Go to app settings or navigation',
            `3. Add navigation link with ID: ${odagLink.id}`,
            `4. Set link name: ${options.linkName}`
          ]
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

  // Diagnostic method to test connection and authentication
  async testConnection() {
    try {
      console.log('Testing Qlik Sense connection...');
      
      await this.authenticate();
      
      // Test QRS API
      const qrsResult = await this.validateAppId('00000000-0000-0000-0000-000000000000'); // Invalid ID to test API
      console.log('QRS API: Connection working');
      
      // Test ODAG API
      try {
        const url = `https://${this.config.qlikHost}:${this.config.odagPort}/v1/links?xrfkey=${this.xrfKey}`;
        const response = await axios.get(url, this.axiosConfig);
        console.log('ODAG API: Connection working');
      } catch (odagError) {
        console.log('ODAG API: Connection failed -', odagError.message);
        if (odagError.response?.status === 404) {
          console.log('   ODAG service may not be running on port 9098');
        } else if (odagError.response?.status === 405) {
          console.log('   Check ODAG service configuration and endpoint path');
        }
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

  // Utility method to get app name by ID (optional helper)
  async getAppNameById(appId) {
    try {
      const validation = await this.validateAppId(appId);
      return validation.valid ? validation.name : null;
    } catch (error) {
      throw new Error(`Failed to get app name for ID ${appId}: ${error.message}`);
    }
  }

  // Utility method to validate expression against Engine
  async validateExpression(appId, expression) {
    return new Promise((resolve, reject) => {
      const wsUrl = this.config.virtualProxy
        ? `wss://${this.config.qlikHost}:${this.config.enginePort}/${this.config.virtualProxy}/app/${appId}`
        : `wss://${this.config.qlikHost}:${this.config.enginePort}/app/${appId}`;
      
      const ws = new WebSocket(wsUrl, {
        headers: {
          'X-Qlik-Xrfkey': this.xrfKey,
          'X-Qlik-User': `UserDirectory=${this.config.userDirectory}; UserId=${this.config.userId}`
        },
        agent: this.httpsAgent
      });

      ws.on('open', () => {
        const validateRequest = {
          handle: -1,
          method: 'CheckExpression',
          params: [expression],
          jsonrpc: '2.0',
          id: 1
        };

        ws.send(JSON.stringify(validateRequest));
      });

      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data);
          
          if (response.error) {
            resolve({ valid: false, error: response.error.message });
          } else if (response.result) {
            resolve({ valid: true, result: response.result });
          }
          
          ws.close();
        } catch (error) {
          reject(error);
        }
      });

      ws.on('error', reject);
    });
  }
}

// Create service instance
const odagService = new ODAGLinkCreator(config);

// Example function to create an ODAG link using your specific App IDs
async function createSalesDetailLink() {
  const options = {
    selectionAppId: '387139c2-c2d7-4442-8201-ec30307f8ab1', // ODAG Sample Selection
    templateAppId: '09338ae2-5727-4652-a911-a333a7a92766',   // ODAG Sample Detail
    linkName: 'My Test ODAG Link',
    description: 'Drill into detailed sales data',
    rowEstExpr: 'Sum(FLIGHT_COUNT)', // Example expression - adjust as needed
    rowEstRange: [{ 
      context: 'User_*', 
      lowBound: 1, 
      highBound: 1000 
    }],
    appRetentionTime: [{ 
      context: 'User_*', 
      minutes: 7200 // 14 days
    }],
    genAppName: [{ 
      context: 'User_*', 
      formatString: 'Flight Info - $(user.name) - $(=Now())' 
    }]
  };

  console.log('Testing ODAG link creation with your apps...');
  const result = await odagService.createCompleteODAGLink(options);
  console.log('Result:', result);
  return result;
}

// REST API endpoint example (if you want to expose this as a service)
import express from 'express';

const app = express();
app.use(express.json());

// Test connection endpoint
app.get('/api/odag/test-connection', async (req, res) => {
  try {
    const result = await odagService.testConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/odag/create', async (req, res) => {
  try {
    const result = await odagService.createCompleteODAGLink(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/api/odag/validate-expression', async (req, res) => {
  try {
    const { appId, expression } = req.body;
    const validation = await odagService.validateExpression(appId, expression);
    res.json(validation);
  } catch (error) {
    res.status(500).json({ 
      valid: false, 
      error: error.message 
    });
  }
});

app.get('/api/odag/test', async (req, res) => {
  try {
    const result = await createSalesDetailLink();
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ODAG Link Creator Service running on port ${PORT}`);
  console.log(`Ready to create ODAG links with authentication: ${config.userDirectory}\\${config.userId}`);
});

export { ODAGLinkCreator, odagService };

// Uncomment to run the example with your specific apps
createSalesDetailLink();
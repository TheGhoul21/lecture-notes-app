const { google } = require('googleapis');
const config = require('../utils/config');
const fs = require('fs').promises;
const path = require('path');
const http = require('http');
const url = require('url');

const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token.json');

const authClient = new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    config.googleRedirectUri
);


async function saveToken(token) {
  try {
    await fs.writeFile(TOKEN_PATH, JSON.stringify(token));
    console.log('Token stored to', TOKEN_PATH);
  } catch (err) {
    console.error('Error saving token:', err);
  }
}

async function loadToken() {
  try {
    const token = await fs.readFile(TOKEN_PATH);
    authClient.setCredentials(JSON.parse(token));
    return authClient;
  } catch (err) {
    return null; // Token does not exist or is invalid
  }
}

async function authorize() {
  let client = await loadToken();
  if (client) {
    return client; // Already authenticated
  }

  return new Promise((resolve, reject) => {
    const authUrl = authClient.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    console.log('Authorize this app by visiting this URL:', authUrl);

    const server = http.createServer(async (req, res) => {
        const parsedUrl = url.parse(req.url, true);
        if(parsedUrl.pathname === '/callback') {
            const code = parsedUrl.query.code;
            if(code){
                try{
                   const {tokens} = await authClient.getToken(code);
                    authClient.setCredentials(tokens);
                    await saveToken(tokens);
                    res.end('Authentication successful! You can now close this tab.');
                    server.close();
                    resolve(authClient);
                } catch(err){
                    console.error('Error getting token', err);
                    res.end('Error getting tokens, check console')
                    server.close();
                    reject(err);
                }

            } else {
                res.end("No code received");
                server.close();
                reject("No code received")
            }
        } else {
            res.statusCode = 404;
            res.end("Not found");
        }
    });

    server.listen(3000, () => {
      console.log('Server started on port 3000. Awaiting Google authentication callback...');
    });

  });
}

module.exports = { authorize, authClient };
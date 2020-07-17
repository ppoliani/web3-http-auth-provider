const errors = require('web3-core-helpers').errors;
const XHR2 = require('xhr2-cookies').XMLHttpRequest; 
const http = require('http');
const https = require('https');

class HttpProvider {
  constructor(host, options={}) {
    this.withCredentials = options.withCredentials || false;
    this.timeout = options.timeout || 0;
    this.headers = options.headers || [];
    this.agent = options.agent;
    this.connected = false;
    this.getAccessToken = options.getAccessToken;
    this.syncInterval = options.syncInterval || 60000 // 1 min

    var keepAlive = (options.keepAlive === true || options.keepAlive !== false) ? true : false;
    this.host = host || 'http://localhost:8545';
    if (!this.agent) {
      if (this.host.substring(0,5) === "https") {
        this.httpsAgent = new https.Agent({ keepAlive: keepAlive });
      } 
      else {
        this.httpAgent = new http.Agent({ keepAlive: keepAlive });
      }
    }

    return new Promise(async (resolve, reject) => {
      try {
        await this._syncAuth();
        resolve(this);
      }
      catch(error) {
        reject(error)
      }
    });
  }

  replaceAuthzHeader(header) {
    const index = this.headers.findIndex(h => h.name === 'Authorization');

    if(index !== -1) {
      this.headers.splice(index, 1, header);
    }
    else {
      this.headers.push(header);
    }
  }

  async _refreshToken() {
    try {
      this._token = await this.getAccessToken();
      
      const header = {name: 'Authorization', value: `Bearer ${this._token}`};
      this.replaceAuthzHeader(header);
      
      this._tick();
    }
    catch(error) {
      throw new Error('Cannot get a new access token');
    }
  }

  async _syncAuth() {
    if(this.getAccessToken !== null) {
      try {
        await this._refreshToken();
      }
      catch {
        this._tick(10000); // retry in 10 secs
      }
    }
  }

  _tick(ts=this.syncInterval) {
    setTimeout(() => this._syncAuth(), ts);
  }

  _hasTokenExpired() {
    const universalBtoa = b64Encoded => {
      try {
        return atob(b64Encoded);
      } catch (err) {
        return Buffer.from(b64Encoded, 'base64').toString();
      }
    };

    const base64Url = this._token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      universalBtoa(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );

    const {exp} = JSON.parse(jsonPayload);

    return Math.floor(Date.now() / 1000) > exp;
  }

  _prepareRequest() {
    let request;

    // the current runtime is a browser
    if (typeof XMLHttpRequest !== 'undefined') {
      request = new XMLHttpRequest();
    } 
    else {
      request = new XHR2();
      const agents = {httpsAgent: this.httpsAgent, httpAgent: this.httpAgent, baseUrl: this.baseUrl};

      if (this.agent) {
        agents.httpsAgent = this.agent.https;
        agents.httpAgent = this.agent.http;
        agents.baseUrl = this.agent.baseUrl;
      }

      request.nodejsSet(agents);
    }

    request.open('POST', this.host, true);
    request.setRequestHeader('Content-Type','application/json');
    request.timeout = this.timeout;
    request.withCredentials = this.withCredentials;

    if(this.headers) {
      this.headers.forEach(header => {
        request.setRequestHeader(header.name, header.value);
      });
    }

    return request;
  }

  async send(payload, callback) {
    if(this._hasTokenExpired()) {
      await this._refreshToken();
    }

    const request = this._prepareRequest();

    request.onreadystatechange = () => {
      if (request.readyState === 4 && request.timeout !== 1) {
        let result = request.responseText;
        let error = null;

        try {
          result = JSON.parse(result);
        } catch(e) {
          error = errors.InvalidResponse(request.responseText);
        }

        this.connected = true;
        callback(error, result);
      }
    };

    request.ontimeout = () => {
      this.connected = false;
      callback(errors.ConnectionTimeout(this.timeout));
    };

    try {
      request.send(JSON.stringify(payload));
    } 
    catch(error) {
      this.connected = false;
      callback(errors.InvalidConnection(this.host));
    }
  }

  disconnect() {
    //NO OP
  }

  supportsSubscriptions() {
    return false;
  }
}

module.exports = HttpProvider;

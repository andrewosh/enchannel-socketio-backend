const request = require('request');
const urljoin = require('url-join');
const connectionsMap = {};
const rxjs = require('@reactivex/rxjs');
const { Subscriber, Observable, Subject } = rxjs;

// BEGIN FROM ENCHANNEL-ZMQ
function deepFreeze(obj) {
  // Freeze properties before freezing self
  Object.getOwnPropertyNames(obj).forEach(name => {
    const prop = obj[name];
    if(typeof prop === 'object' && prop !== null && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  });
  // Freeze self
  return Object.freeze(obj);
}

function createSubscriber(socket) {
  return Subscriber.create(messageObject => {
    socket.emit('msg', messageObject);
  }, err => {
    // We don't expect to send errors to the kernel
    console.error(err);
  }, () => {
    // tear it down, tear it *all* down
    socket.removeAllListeners();
    socket.close();
  });
}

function createObservable(socket) {
  return Observable.fromEvent(socket, 'msg')
                   .map(msg => deepFreeze(msg))
                   .publish()
                   .refCount();
}

function createSubject(socket) {
  const subj = Subject.create(createSubscriber(socket),
                              createObservable(socket));
  return subj;
}
// END FROM ENCHANNEL-ZMQ

function rp(url) {
  return new Promise((resolve, reject) => {
    request(url, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        console.log('BACKEND GOT: ' + JSON.stringify(body))
        resolve(body);
      } else {
        reject(body);
      }
    });
  });
}

export function spawn(endpoint, kernelName) {
  return rp(urljoin(endpoint, 'spawn', kernelName)).then(x => JSON.parse(x).id );
}

export function list(endpoint) {
  return rp(urljoin(endpoint, 'list')).then(x => JSON.parse(x))
}

export function specs(endpoint) {
  console.log('BACKEND: getting all specs at ' + urljoin(endpoint, 'specs'))
  return rp(urljoin(endpoint, 'specs')).then(x => JSON.parse(x))
}

export function connect(endpoint, kernelId) {
  var url = require('url').parse(endpoint)
  var path = url.path + 'socket.io/'
  const Manager = require('socket.io-client').Manager
  const Socket = require('socket.io-client').Socket
  var io = Manager(url.href, { path })
  return new Promise(resolve => {
    var connections = connectionsMap[kernelId] = {
      shell: new Socket(io, '/shell/' + kernelId).connect(),
      stdio: new Socket(io, '/stdio/' + kernelId).connect(),
      iopub: new Socket(io, '/iopub/' + kernelId).connect(),
      control: new Socket(io, '/control/' + kernelId).connect()
    };
    resolve({
      shell: createSubject(connections.shell),
      control: createSubject(connections.control),
      iopub: createSubject(connections.iopub),
      stdio: createSubject(connections.stdio)
    });
  });
}

export function disconnect(kernelId) {
  connectionsMap[kernelId].shell.disconnect();
  connectionsMap[kernelId].stdio.disconnect();
  connectionsMap[kernelId].iopub.disconnect();
  connectionsMap[kernelId].control.disconnect();
}

export function shutdown(endpoint, id) {
  return rp(urljoin(endpoint, 'shutdown', id)).then(x => {
    if (JSON.parse(x).id !== id) return Promise.reject('wrong kernel stopped');
  });
}

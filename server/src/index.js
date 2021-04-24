import dotenv from 'dotenv';
const path = require('path');
dotenv.config({
  path: path.resolve(
    process.cwd(),
    process.env.NODE_ENV == 'prod' ? '.env' : '.env.docker'
  ),
});
import cors from 'cors';
import express from 'express';
const app = express();

const fs = require('fs');
const http = require('http');
const server = http.createServer(app);
const axios = require('axios');
let sessionid;
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const MQTTHOST = process.env.MQTTHOST || '3.88.213.87';
const RHASSPY_PORT = process.env.RHASSPY_PORT || 12183;

const io = require('socket.io')(server, {
  cors: {
    origin: '*',
  },
});
const ss = require('socket.io-stream');

console.log(process.env.MQTTHOST);

// MQTT
const mqtt = require('mqtt');
const mqtt_options = {
  host: 'rhasspy',
  port: RHASSPY_PORT,
  protocol: 'mqtt',
};

app.use(cors());

app.get('/', (req, res) => {
  res.send('Hello World!');
});

const mqtt_client = mqtt.connect(mqtt_options);

// Subscribe 'intent recognition'
mqtt_client.subscribe('hermes/intent/#', function (err) {
  if (!err) {
    console.log('subscribe success hermes intent');
  } else {
    console.log(err);
  }
});

mqtt_client.subscribe('hermes/nlu/intentNotRecognized', function (err) {
  if (!err) {
    console.log('subscribe success hermes intentNotRecognized');
  } else {
    console.log(err);
  }
});

// Subscribe 'get audio buffer from tts'
mqtt_client.subscribe('hermes/audioServer/default/playBytes/#', function (err) {
  if (!err) {
    console.log(`subscribe to MQTT Host: ${MQTTHOST}`);
    sessionid
      ? io.to(sessionid).emit('mqtt_setup', `MQTT subscription: successfull`)
      : null;
  } else {
    console.log(err);
    sessionid
      ? io.to(sessionid).emit('mqtt_setup', `MQTT subscription: ${err}`)
      : null;
  }
});

// When subscribed topic is published  - you get message here
mqtt_client.on('message', function (topic, message) {
  // get 'intent recognition' message
  console.log('topic: ' + topic);
  // console.log('message: ' + message);
  if (topic.indexOf('hermes/intent/') === 0) {
    processIntent(message);
  } else if (topic.indexOf('hermes/nlu/intentNotRecognized')) {
    io.to(sessionid).emit('intentNotRecognized', message);
  } else if (topic.indexOf('hermes/audioServer/default/playBytes/') === 0) {
    // get audio buffer from tts
    console.log('topic: ' + topic);
    fs.writeFile('result.wav', message, function (err) {
      if (!err) {
        console.log('audio write success');
      }
    });
  }
});

io.on('connection', (client) => {
  console.log('client connected');
  client.on('disconnect', () => {
    console.log('client disconnected');
  });
  client.emit('server_setup', `${client.id}`);

  sessionid = client.id;
  console.log(sessionid);

  // when the client sends 'stream' events
  ss(client).on('stream', async (stream, data) => {
    // console.log('STREAM');
    // get the name of the stream
    const filename = path.basename(data.name);

    // pipe the filename to the stream
    stream.pipe(fs.createWriteStream(filename));
    stream.on('data', (chunk) => {
      mqtt_client.publish('hermes/audioServer/default/audioFrame', chunk);
    });
    stream.on('end', () => {
      // console.log('END');
    });

    stream.on('err', (err) => {
      console.log(err);
    });
  });
});

// send text to tts (sample code)
const sendTTS = () => {
  let msg = 'hello world';
  const host_path =
    'http://' + process.env.MQTTHOST + ':12101/api/text-to-speech';

  axios
    .post(host_path, msg)
    .then((res) => {
      console.log(`statusCode: ${res.statusCode}`);
      console.log(res);
    })
    .catch((error) => {
      console.error(error);
    });
};

const processIntent = (message) => {
  let intentJSON = JSON.parse(message);
  // send intent json to frontend
  if (sessionid) {
    io.to(sessionid).emit('intent', intentJSON);
  }

  // sample code for intent json parsing
  console.log('input: ' + intentJSON.input);
  console.log('intentName: ' + intentJSON.intent.intentName);
  if (intentJSON.slots[0] == undefined) {
    console.log('this intention has no slots');
  } else {
    for (var i in intentJSON.slots) {
      console.log('entity: ' + intentJSON.slots[i].entity);
      console.log('value: ' + intentJSON.slots[i].value.value);
    }
  }
};

server.listen(PORT, HOST, () =>
  console.log(`Example app listening on host ${HOST} and port ${PORT}!`)
);

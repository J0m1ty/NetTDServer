const { v4: uuidv4 } = require('uuid');

const port = 3000;
const { createServer } = require('http');
const server = createServer();
const { Server } = require("socket.io");
const { debug } = require('console');

const io = new Server(server);

io.use((socket, next) => {
    if (socket.handshake.query.token === "UNITY") {
        next();
    } else {
        next(new Error("Authentication error"));
    }
});

const unauth = new Set();

const users = new Set();

const active = new Set();

class User {
    constructor(id, name) {
        this.id = id;
        this.name = name;
    }
}

setInterval(() => {
    console.log("Users: ", users);
    console.log("Active: ", active);
    console.log("Unauth: ", unauth);
}, 2000);

io.on('connection', (socket) => {
    console.log('a user connected');

    let user = null;

    unauth.add(socket.id);
    
    socket.on("auth", (player, callback) => {
        console.log("authAttempt")
        if (unauth.has(socket.id)) {
            let valid = Array.from(users).find(u => u.name === player.name && u.id === player.id);

            if (valid) {
                unauth.delete(socket.id);
                user = valid;
                active.add(valid);
                callback({player: valid});
            }
            else {
                callback({error: "No such player exists"});
            }
        }
        else {
            callback({error: "Unexpected error"});
        }
    });
    
    socket.on('register', (player, callback) => {
        console.log("registerAttempt")
        let valid = Array.from(users).find(u => u.name === player.name);
        if (!valid) {
            let id = uuidv4();
            let newUser = new User(id, player.name);
            users.add(newUser);
            callback({player: newUser});
        }
        else {
            console.log(player);
            if (player.id === valid.id) {
                callback({player: valid});
            }
            else {
                callback({error: "Name already taken"});
            }
        }
    });

    socket.on('disconnect', () => {
        if (unauth.has(socket.id)) {
            unauth.delete(socket.id);
        }
        else if (active.has(user)) {
            active.delete(user);
            user = null;
        }
        
        console.log('user disconnected');
    });
});

server.listen(port, () => {
    console.log(`listening on *:${port}`);
});
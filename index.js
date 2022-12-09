const { v4: uuidv4 } = require('uuid');

const port = 3000;
const { createServer } = require('http');
const server = createServer();
const { Server } = require("socket.io");

const io = new Server(server);

io.use((socket, next) => {
    if (socket.handshake.query.token === "UNITY") {
        next();
    } else {
        next(new Error("Authentication error"));
    }
});

const GameState = {
    STARTING: "starting",
    ACTIVE: "active",
    ENDED: "ended"
};

class User {
    constructor(id, username, passhash = null) {
        this.id = id;
        this.username = username;
        this.passhash = passhash;
        this.room = null;

        this.gameInfo = {};
    }
}

class Chat {
    constructor(data) {
        if (!data.room) {
            throw new Error("No room");
        }

        this.room = data.room;
        this.max = data.max ?? Infinity;
        this.maxChars = data.maxChars ?? Infinity;
        this.messages = data.messages ?? [];
        this.filterProfanity = data.filterProfanity ?? true;
        this.displayName = data.displayName ?? this.room?.id ?? "Chat";
    }

    sendServerMessage(message) {
        this.sendMessage("Server", message);
    }

    sendMessage(username, message) {
        if (username != "Server" && !this.room.users.find(u => u.username === username)) {
            return {error: "Not in room"};
        }
        
        if (message.trim().length > this.maxChars) {
            return {error: "Message too long"};
        }
        
        if (message.trim().length <= 1) {
            return {error: "Message too short"};
        }

        if (this.filterProfanity) {
            //message = await fetch("https://www.purgomalum.com/service/plain?text=" + message);
            //add later ig
        }

        let data = {
            roomId: this.room.id,
            username: username,
            message: message,
            timestamp: Date.now()
        };

        this.messages.push(data);
        
        io.to(this.room.id).emit("message", {data: data, users: this.room.getUsers()});

        return {data: data, users: this.room.getUsers()};
    }
}

class Game {
    constructor(data) {
        if (!data.room) {
            throw new Error("No room");
        }

        this.room = data.room;
        this.allReady = false;
        this.gameState = GameState.STARTING;
        
        this.room.users.forEach(user => {
            user.gameInfo = {ready: false, health: 100, money: 10, towers: [], units: []};
        });
    }

    setReady(user) {
        if (!this.room.users.find(u => u.id === user.id)) {
            return {error: "Not in game"};
        }

        if (this.gameState !== GameState.STARTING) {
            return {error: "Game already started"};
        }
        
        user.gameInfo.ready = true;
        
        if (this.room.users.every(user => user.gameInfo.ready)) {
            this.allReady = true;
            this.gameState = GameState.ACTIVE;

            io.to(this.room.id).emit("allReady", {data: {roomId: this.room.id}, users: this.room.getUsers()});
        }
        
        
        return {data: {roomId: this.room.id}, users: this.room.getUsers()};
    }
}

class Room {
    constructor(id, max = 2, users = []) {
        if (typeof id != "string") {
            throw new Error("Room id must be a string");
        }

        if (id.length != 4) {
            throw new Error("Room id must be 4 characters");
        }
        
        id = id.toUpperCase();
        
        if (!/^[A-Z0-9]+$/.test(id)) {
            throw new Error("Room id must only contain letters and numbers");
        }

        this.id = id;
        this.max = max;
        this.users = users;
        this.chat = new Chat({room: this, max: max, users: users});
        this.game = null;
    }

    startGame() {
        if (this.game) {
            return {error: "Game already started"};
        }

        if (this.users.length < 2) {
            return {error: "Not enough players"};
        }

        this.game = new Game({room: this});

        io.to(this.id).emit("start", {data: {roomId: this.id}, users: this.getUsers()});

        return {data: {roomId: this.id}, users: this.getUsers()};
    }

    endGame() {
        this.game = null;
        
        let data = {
            roomId: this.id,
        };
        io.to(this.id).emit("end", {data: data, users: this.getUsers()});
    }

    addUser(user) {
        if (this.users.length >= this.max) {
            return false;
        }

        if (this.users.includes(user)) {
            return false;
        }

        console.log("adding user " + JSON.stringify(user), this.users, this.id);

        this.users.push(user);
        user.room = this;
        
        io.to(this.id).emit("users", {data: {roomId: this.id}, users: this.getUsers()});

        if (this.id != mainId) {
            this.chat.sendServerMessage(`${user.username} has joined the room.`);
        }
    }

    removeUser(user) {
        if (this.id == mainId) {
            this.users = this.users.filter(u => u.id != user.id);
            user.room = null;
            
            console.log("menu kinda removing user " + JSON.stringify(user), this.users, this.id);

            return;
        }

        this.users = this.users.filter(u => u.id != user.id);
        user.room = null;

        io.to(this.id).emit("users", {data: {roomId: this.id}, users: this.getUsers()});

        console.log("really removing user " + JSON.stringify(user), this.users, this.id);

        if (this.game) {
            this.endGame();
        }

        if (this.users.length == 0) {
            this.chat.sendServerMessage(`Room closing.`);
            io.in(this.id).socketsLeave(this.id);
            rooms.delete(this);
        }
    }

    getUsers() {
        return this.users.map(u => {return {username: u.username};});
    }
}

const mainId = "MAIN";
const unauth = new Set();
const users = new Set();
const active = new Set();
const rooms = new Set();

const mainRoom = new Room(mainId, Infinity, []);
rooms.add(mainRoom);

// every 5 seconds, print users
// setInterval(() => {
//     console.log("users", users);
// }, 5000);

io.on('connection', (socket) => {
    console.log('a user connected');

    let user = null;

    unauth.add(socket.id);
    
    socket.on("auth", (data, callback) => {
        let authId = data.id;
        let authUsername = data.username;
        let authPasshash = data.passhash;

        console.log(user);
        
        if (Array.from(active).filter(u => u.username == authUsername).length > 0) {
            callback({error: "Already logged in"});
            return;
        }
        
        if (unauth.has(socket.id)) {
            let valid = Array.from(users).find(u => (u.username == authUsername && (u.id == authId || u.passhash == authPasshash)));

            if (valid) {
                unauth.delete(socket.id);
                user = valid;
                active.add(user);
                
                joinRoom(mainRoom);

                console.log("User authenticated");
                callback({data: {
                    id: user.id,
                    username: user.username,
                    passhash: user.passhash
                }});
                
            }
            else {
                console.log("No such player exists");
                callback({error: "No such player exists"});
            }
        }
        else {
            console.log("Try logging out");
            callback({error: "Try logging out"});
        }
    });
    
    socket.on('register', (data, callback) => {
        let username = data.username;
        let passhash = data.passhash;

        if (username.length < 3 || username.length > 12) {
            callback({error: "Username must be between 3 and 12 characters"});
            return;
        }
        
        if (Array.from(users).find(u => u.username == username)) {
            var found = Array.from(users).find(u => u.username == username && u.passhash == passhash);
            if (found) {
                callback({data: {
                    id: found.id,
                    username: found.username,
                    passhash: found.passhash
                }});
                return;
            }
            else {
                callback({error: "Username already taken"});
                return;
            }
        }
        
        let id = uuidv4();
        let newUser = new User(id, username, passhash);
        users.add(newUser);
        
        callback({data: {
            id: newUser.id,
            username: newUser.username,
            passhash: newUser.passhash
        }});
    });

    function leaveRoom() {
        let room = user?.room;
        
        if (room) {
            console.log("leaving room " + room.id);

            if (room.id == mainId) {
                user.room = null;
                console.log("fake removing user " + room.id);
            }
            else {
                room.removeUser(user);
                socket.leave(room.id);
            }
        }
    }

    function joinRoom(room) {
        leaveRoom();

        socket.join(room.id);
        room.addUser(user);
        
        return room.getUsers();
    }

    socket.on('joinRoom', (data, callback) => {
        console.log("joining room", data.roomId);

        if (unauth.has(socket.id) || !active.has(user)) {
            callback({error: "Not authenticated"});
            return;
        }

        let roomId = data.roomId;

        if (roomId == mainId) {
            leaveRoom();

            let users = mainRoom.getUsers();

            callback({data: {roomId: mainId}, users: users});

            let messageData = {
                roomId: mainId,
                username: "Server",
                message: "Welcome to .NetTD!",
                timestamp: Date.now()
            };

            socket.emit("message", {data: messageData, users: users});
            
            return;
        }

        let room = Array.from(rooms).find(r => r.id == roomId);

        if (!room) {
            callback({error: "No such room exists"});
            return;
        }
        
        if (user?.room?.id == room.id) {
            callback({error: "Already in room"});
            return;
        }

        if (room.users.length >= room.max) {
            callback({error: "Room is full"});
            return;
        }
        
        let safeUsers = joinRoom(room);

        callback({data: {roomId: room.id}, users: safeUsers});
    });

    socket.on('hostRoom', (callback) => {
        if (unauth.has(socket.id) || !active.has(user)) {
            callback({error: "Not authenticated"});
            return;
        }

        let id = Array.from({length: 4}, () => Math.floor(Math.random() * 36).toString(36).toUpperCase()).join('');
        console.log("hosting room", id);

        let room = new Room(id, 2, []);

        if (!Array.from(rooms).find(r => r.id == room.id)) {
            rooms.add(room);

            let safeUsers = joinRoom(room);

            callback({data: {roomId: room.id}, users: safeUsers});
        }
        else {
            callback({error: "Room already exists"});
        }
    });

    socket.on('message', (data, callback) => {
        if (unauth.has(socket.id) || !active.has(user)) {
            callback({error: "Not authenticated"});
            return;
        }

        console.log(`ROOM ${data.roomId}, ${user.username}: ${data.message}`);

        var roomId = data.roomId;
        var message = data.message;

        if (roomId == mainId) {
            var result = mainRoom.chat.sendMessage(user.username, message);

            if (!result?.error) {
                callback({data: {
                    message: result.data.message,
                    roomId: result.data.roomId,
                    username: result.data.username,
                    timestamp: result.data.timestamp,
                }, users: result.users});
            }
            else {
                callback({error: result.error});
            }
            return;
        }
        
        if (!user.room) {
            callback({error: "Not in a room"});
            return;
        }

        if (roomId != user.room.id) {
            callback({error: "Invalid room ID"});
            return;
        }
        
        var result = user.room.chat.sendMessage(user.username, message);

        if (!result?.error) {
            callback({data: {
                message: result.data.message,
                roomId: result.data.roomId,
                username: result.data.username,
                timestamp: result.data.timestamp,
            }, users: result.users});
        }
        else {
            callback({error: result.error});
        }
    });

    socket.on('startMatch', (data, callback) => {
        if (unauth.has(socket.id) || !active.has(user)) {
            callback({error: "Not authenticated"});
            return;
        }

        let roomId = data.roomId;

        // get room of roomId
        let room = Array.from(rooms).find(r => r.id == roomId);

        if (roomId == mainId || !room) {
            callback({error: "Not a valid room"});
            return;
        }

        var result = room.startGame();

        if (result.error) {
            callback({error: result.error});
            return;
        }
        else {
            callback({data: {roomId: result.data.roomId}, users: result.users});
        }
    });

    socket.on('ready', (data, callback) => {
        if (unauth.has(socket.id) || !active.has(user)) {
            callback({error: "Not authenticated"});
            return;
        }

        let roomId = data.roomId;

        // get room of roomId
        let room = Array.from(rooms).find(r => r.id == roomId);

        if (roomId == mainId || !room) {
            callback({error: "Not a valid room"});
            return;
        }

        if (!room.game) {
            callback({error: "No game in progress"});
            return;
        }
        
        let result = room.game.setReady(user);

        if (result.error) {
            callback({error: result.error});
        }
        else {
            callback({data: {roomId: result.data.roomId}, users: result.users});
        }
    });

    socket.on('disconnect', () => {
        if (unauth.has(socket.id)) {
            unauth.delete(socket.id);
        }
        else if (active.has(user)) {
            leaveRoom();
            mainRoom.removeUser(user);
            active.delete(user);
            user = null;
        }
        
        console.log('user disconnected');
    });
});

server.listen(port, () => {
    console.log(`listening on *:${port}`);
});
const express = require('express');
const path = require('path');
const redis = require('redis');
const bcrypt = require('bcrypt');
const session = require('express-session');
const client = redis.createClient();
const { promisify } = require('util');
const { formatDistance } = require('date-fns');

const app = express();

const RedisStore = require('connect-redis')(session);

app.use(express.urlencoded({ extended: true }));

app.use(
	session({
		store: new RedisStore({ client: client }),
		resave: false,
		saveUninitialized: false,
		cookie: {
			maxAge: 3600000, //60 minutes, in milliseconds
			httpOnly: false,
			secure: false,
		},
		secret: '6fVcf34g)(jiuh/gfd_tgh6Dre4wQo0=',
	})
);

app.set('view engine', 'pug');
app.set('views', path.join(__dirname, 'views'));

const ahget = promisify(client.hget).bind(client);
const asmembers = promisify(client.smembers).bind(client);
const ahkeys = promisify(client.hkeys).bind(client);
const aincr = promisify(client.incr).bind(client);
const alrange = promisify(client.lrange).bind(client);

app.get('/', async (req, res) => {
	if (req.session.userid) {
		const currentUserName = await ahget(`user:${req.session.userid}`, 'username');
		const following = await asmembers(`following:${currentUserName}`);
		const users = await ahkeys('users');

		const timeline = [];
		const posts = await alrange(`timeline:${currentUserName}`, 0, 100);

		for (let post of posts) {
			const timestamp = await ahget(`post:${post}`, 'timestamp');
			const timeString = formatDistance(new Date(), new Date(parseInt(timestamp)));

			timeline.push({
				message: await ahget(`post:${post}`, 'message'),
				author: await ahget(`post:${post}`, 'username'),
				timeString: timeString,
			});
		}
    // const handleLogout = () => {
    //   window.localStorage.clear();
    //   window.location.reload(true);
    //   window.location.replace('/');
    // };


		res.render('dashboard', {
			users: users.filter((user) => user !== currentUserName && following.indexOf(user) === -1),
			currentUserName,
			timeline,
		});
	} else {
		res.render('login');
	}
});

app.get('/post', (req, res) => {
	if (req.session.userid) {
		res.render('post');
	} else {
		res.render('login');
	}
});

app.get('/logout', (req, res) => {
	if (req.session.userid) {
		req.session.destroy(err => {
			if (err) {
				console.error(err);
			}
		});
	}

	res.redirect('/');
});

app.post('/', (req, res) => {
	const { username, password } = req.body;

	if (!username || !password) {
		res.render('error', {
			message: 'Please set both username and password',
		});
		return;
	}

	const saveSessionAndRenderDashboard = userid => {
		req.session.userid = userid;
		req.session.save();
		res.redirect('/');
	}



	const handleSignup = (username, password) => {
		client.incr('userid', async (err, userid) => {
			client.hset('users', username, userid);

			const saltRounds = 10;
			const hash = await bcrypt.hash(password, saltRounds);

			client.hmset(`user:${userid}`, 'hash', hash, 'username', username);

			saveSessionAndRenderDashboard(userid);
		});
	}

	const handleLogin = (userid, password) => {
		client.hget(`user:${userid}`, 'hash', async (err, hash) => {
			const result = await bcrypt.compare(password, hash);
			if (result) {
				saveSessionAndRenderDashboard(userid);
			} else {
				res.render('error', {
					message: 'Incorrect password',
				});
				return;
			}
		});
	}

	client.hget('users', username, (err, userid) => {
		if (!userid) {
			//user does not exist, signup procedure
			handleSignup(username, password);
		} else {
			//user exists, login procedure
			handleLogin(userid, password);
		}
	});
});

app.post('/post', async (req, res) => {
	if (!req.session.userid) {
		res.render('login');
		return;
	}

	const { message } = req.body;
	const currentUserName = await ahget(`user:${req.session.userid}`, 'username');
	const postid = await aincr('postid');
	client.hmset(
		`post:${postid}`,
		'userid',
		req.session.userid,
		'username',
		currentUserName,
		'message',
		message,
		'timestamp',
		Date.now()
	);
	client.lpush(`timeline:${currentUserName}`, postid);

	const followers = await asmembers(`followers:${currentUserName}`);
	for ( let follower of followers) {
		client.lpush(`timeline:${follower}`, postid);
	}

	res.redirect('/');
});

app.post('/follow', (req, res) => {
	if (!req.session.userid) {
		res.render('login');
		return;
	}

	const { username } = req.body;

	client.hget(
		`user:${req.session.userid}`,
		'username',
		(err, currentUserName) => {
			client.sadd(`following:${currentUserName}`, username);
			client.sadd(`followers:${username}`, currentUserName);
		}
	);

	res.redirect('/');
})
app.listen(3000, () => console.log('Server ready'));

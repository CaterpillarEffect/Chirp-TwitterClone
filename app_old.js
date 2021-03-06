const express = require('express')
const path = require('path')
const redis = require('redis')
const bcrypt = require('bcrypt')
const session = require('express-session')

const app = express()
const client = redis.createClient()

const RedisStore = require('connect-redis')(session)

app.use(express.urlencoded({ extended: true }))
app.use(
  session({
    store: new RedisStore({ client: client }),
    resave: true,
    saveUninitialized: true,
    cookie: {
      maxAge: 36000000,
      httpOnly: false,
      secure: false,
    },
    secret: 'bM80SARMxlq4fiWhulfNSeUFURWLTY8vyf',
  })
)

app.set('view engine', 'pug')
app.set('views', path.join(__dirname, 'views'))

app.get('/', (req, res) => {
  if (req.session.userid) {
    res.render('dashboard')
  } else {
    res.render('login')
  }
})

app.post('/', (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    res.render('error', {
      message: 'Please set both username and password'
    })
    return
  }

  const saveSessionAndRenderDashboard = userid => {
    req.session.userid = userid
    req.session.save()
    res.render('dashboard')
  }

  const handleSignup = (username, password) => {
    client.incr('userid', async (err, userid) => {
      client.hset('users', username, userid)

      const saltRounds = 10
      const hash = await bcrypt.hash(password, saltRounds)

      client.hset(`user:${userid}`, 'hash', hash, 'username', username)


      saveSessionAndRenderDashboard(userid)
    })
  }

  const handleLogin = (userid, password) => {
    client.hget(`user:${userid}`, 'hash', async (err, hash) => {
      const result = await bcrypt.compare(password, hash)
      if (result) {
        saveSessionAndRenderDashboard(userid)
      } else {
        res.render('error', {
          message: 'Incorrect password',
        })
        return
      }
    })
  }

  client.hget('users', username, (err, userid) => {
    if (!userid) { //signup procedure
      handleSignup(username, password)
    } else { //login procedure
      handleLogin(userid, password)
    }
  })
})

app.listen(3000, () => console.log('Server ready'))

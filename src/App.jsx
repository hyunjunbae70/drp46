import { useEffect, useState } from "react"
import { supabase } from "./lib/supabase"

export default function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [fullName, setFullName] = useState("")
  const [username, setUsername] = useState("")
  const [profile, setProfile] = useState(null)
  const [message, setMessage] = useState("")

  async function getProfile(userId) {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()

    if (error) {
      setMessage(error.message)
      return
    }

    setProfile(data)
    setFullName(data.full_name || "")
    setUsername(data.username || "")
  }

  async function signUp(event) {
    event.preventDefault()
    setMessage("")

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    if (data.user) {
      const { error: profileError } = await supabase.from("profiles").insert({
        id: data.user.id,
        full_name: fullName,
        username,
      })

      if (profileError) {
        setMessage(profileError.message)
        return
      }
    }

    setMessage("Account created. Check your email if confirmation is enabled.")
  }

  async function signIn(event) {
    event.preventDefault()
    setMessage("")

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setMessage(error.message)
      return
    }

    setSession(data.session)
    await getProfile(data.user.id)
  }

  async function signOut() {
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setEmail("")
    setPassword("")
    setFullName("")
    setUsername("")
    setMessage("Signed out.")
  }

  async function updateProfile(event) {
    event.preventDefault()
    setMessage("")

    const userId = session.user.id

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        username,
      })
      .eq("id", userId)

    if (error) {
      setMessage(error.message)
      return
    }

    await getProfile(userId)
    setMessage("Profile updated.")
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)

      if (data.session?.user) {
        getProfile(data.session.user.id)
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)

      if (newSession?.user) {
        getProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!session) {
    return (
      <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
        <h1>User Login</h1>

        <form>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            required
          />

          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Password"
            type="password"
            required
          />

          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Full name"
          />

          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username"
          />

          <button type="submit" onClick={signIn}>
            Log in
          </button>

          <button type="submit" onClick={signUp}>
            Sign up
          </button>
        </form>

        {message && <p>{message}</p>}
      </main>
    )
  }

  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1>Profile</h1>

      <p>Logged in as {session.user.email}</p>

      {profile && (
        <p>
          Current profile: {profile.full_name} / {profile.username}
        </p>
      )}

      <form onSubmit={updateProfile}>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          placeholder="Full name"
        />

        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
        />

        <button type="submit">Save profile</button>
      </form>

      <button type="button" onClick={signOut}>
        Sign out
      </button>

      {message && <p>{message}</p>}
    </main>
  )
}

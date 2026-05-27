import { useEffect, useState } from "react"
import { supabase } from "./lib/supabase"

export default function App() {
  const [users, setUsers] = useState([])
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)

  async function fetchUsers() {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      console.error(error)
      return
    }

    setUsers(data)
  }

  async function addUser(event) {
    event.preventDefault()
    setLoading(true)

    const { error } = await supabase.from("users").insert({
      name,
      email
    })

    if (error) {
      alert(error.message)
    } else {
      setName("")
      setEmail("")
      await fetchUsers()
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  return (
    <main style={{ padding: "2rem", fontFamily: "Arial, sans-serif" }}>
      <h1>Users</h1>

      <form onSubmit={addUser}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          required
        />

        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          type="email"
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Add user"}
        </button>
      </form>

      <h2>Saved users</h2>

      {users.length === 0 ? (
        <p>No users yet.</p>
      ) : (
        <ul>
          {users.map((user) => (
            <li key={user.id}>
              {user.name} — {user.email}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

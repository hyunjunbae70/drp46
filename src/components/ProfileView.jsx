import { useEffect, useState, useCallback } from "react";
import { supabase } from "../lib/supabase";

export default function ProfileView({ session, onSignOut }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [profile, setProfile] = useState({ fullName: "", username: "" });

  const getProfile = useCallback(async () => {
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, username")
      .eq("id", session.user.id)
      .maybeSingle();

    if (error) {
      setMessage({ text: error.message, type: "error" });
      return;
    }

    if (data) {
      setProfile({
        fullName: data.full_name || "",
        username: data.username || "",
      });
    }
  }, [session.user.id]);

  useEffect(() => {
    getProfile();
  }, [getProfile]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ text: "", type: "" });

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: profile.fullName,
        username: profile.username,
      })
      .eq("id", session.user.id);

    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setMessage({ text: "Profile updated successfully!", type: "success" });
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    onSignOut();
  };

  return (
    <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Your Profile</h1>
        <p className="mt-1 text-sm text-gray-500">Logged in as {session.user.email}</p>
      </div>

      <form onSubmit={handleUpdate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Full Name</label>
          <input
            type="text"
            value={profile.fullName}
            onChange={(e) => setProfile((prev) => ({ ...prev, fullName: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Full Name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Username</label>
          <input
            type="text"
            value={profile.username}
            onChange={(e) => setProfile((prev) => ({ ...prev, username: e.target.value }))}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Username"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 p-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none disabled:opacity-50"
        >
          {loading ? "Saving..." : "Save changes"}
        </button>
      </form>

      {message.text && (
        <p className={`text-center text-sm ${message.type === "error" ? "text-red-600" : "text-green-600"}`}>
          {message.text}
        </p>
      )}

      <hr className="border-gray-100" />

      <button
        type="button"
        onClick={handleSignOut}
        className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none"
      >
        Sign out
      </button>
    </div>
  );
}

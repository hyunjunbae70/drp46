import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ProfileView({ session, onSignOut }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  
  // Tracks saved database values for the display section
  const [profile, setProfile] = useState({ fullName: "", username: "" });
  
  // Tracks active typing inputs—starts completely empty
  const [formData, setFormData] = useState({ fullName: "", username: "" });

  useEffect(() => {
    let isMounted = true;

    async function fetchProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, username")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        setMessage({ text: error.message, type: "error" });
        return;
      }

      if (data) {
        setProfile({
          fullName: data.full_name || "",
          username: data.username || "",
        });
        // Form data is deliberately NOT populated here so inputs stay empty at start
      }
    }

    fetchProfile();

    return () => {
      isMounted = false;
    };
  }, [session.user.id]);

  const handleUpdate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage({ text: "", type: "" });

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: formData.fullName,
        username: formData.username,
      })
      .eq("id", session.user.id);

    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      // Update the display readout with the newly saved values
      setProfile({
        fullName: formData.fullName,
        username: formData.username,
      });
      // Clear the text boxes back to empty after a successful save
      setFormData({ fullName: "", username: "" });
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
        <p className="mt-1 text-sm text-gray-500">Manage your account details</p>
      </div>

      {/* Account Info Readout Cards with Grid spacing */}
      <div className="rounded-xl bg-gray-50 p-4 space-y-2 border border-gray-100 text-sm">
        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200 last:border-0">
          <span className="font-medium text-gray-500">Email</span>
          <span className="col-span-2 text-gray-900 font-mono text-xs break-all">{session.user.email}</span>
        </div>
        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200 last:border-0">
          <span className="font-medium text-gray-500">Full Name</span>
          <span className="col-span-2 text-gray-900 truncate">{profile.fullName || "—"}</span>
        </div>
        <div className="grid grid-cols-3 gap-4 py-2 last:border-0">
          <span className="font-medium text-gray-500">Username</span>
          <span className="col-span-2 text-gray-900 truncate">
            {profile.username ? `@${profile.username}` : "—"}
          </span>
        </div>
      </div>

      <hr className="border-gray-100" />

      {/* Edit Form */}
      <form onSubmit={handleUpdate} className="space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">Edit Details</h2>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Update Full Name</label>
          <input
            type="text"
            value={formData.fullName}
            onChange={(e) => setFormData((prev) => ({ ...prev, fullName: e.target.value }))}
            className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Type new full name..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Update Username</label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) => setFormData((prev) => ({ ...prev, username: e.target.value }))}
            className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="Type new username..."
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

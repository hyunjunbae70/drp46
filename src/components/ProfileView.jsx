import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const DIETARY_OPTIONS = [
  { id: "vegan", label: "Vegan", emoji: "🌱" },
  { id: "vegetarian", label: "Vegetarian", emoji: "🥦" },
  { id: "gluten-free", label: "Gluten-Free", emoji: "🌾" },
  { id: "dairy-free", label: "Dairy-Free", emoji: "🥛" },
  { id: "halal", label: "Halal", emoji: "☪️" },
  { id: "kosher", label: "Kosher", emoji: "✡️" },
];

export default function ProfileView({ session, onSignOut, onProfileUpdate }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [isEditing, setIsEditing] = useState(false);

  const [profile, setProfile] = useState({
    fullName: "",
    username: "",
    dietaryRequirements: [],
    budget: 0,
  });

  const [formData, setFormData] = useState({
    fullName: "",
    username: "",
    dietaryRequirements: [],
    budget: 0,
  });

  useEffect(() => {
    let isMounted = true;

    async function fetchProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select("full_name, username, dietary_requirements, budget")
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
          dietaryRequirements: data.dietary_requirements || [],
          budget: data.budget ?? 0,
        });

        setFormData({
          fullName: data.full_name || "",
          username: data.username || "",
          dietaryRequirements: data.dietary_requirements || [],
          budget: data.budget ?? 0,
        });
      }
    }

    fetchProfile();

    return () => {
      isMounted = false;
    };
  }, [session.user.id]);

  const toggleDietary = (id) => {
    setFormData((prev) => {
      const current = prev.dietaryRequirements;
      const updated = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];

      return { ...prev, dietaryRequirements: updated };
    });
  };

  const handleUpdate = async (e) => {
    e.preventDefault();

    const fullName = formData.fullName.trim();
    const username = formData.username.trim();
    const budget = Math.max(0, Number(formData.budget) || 0);

    if (!fullName || !username) {
      setMessage({
        text: "Full name and username cannot be empty.",
        type: "error",
      });
      return;
    }

    setLoading(true);
    setMessage({ text: "", type: "" });

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        username,
        dietary_requirements: formData.dietaryRequirements,
        budget,
      })
      .eq("id", session.user.id);

    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setProfile({
        fullName,
        username,
        dietaryRequirements: formData.dietaryRequirements,
        budget,
      });

      setFormData((prev) => ({
        ...prev,
        fullName,
        username,
        budget,
      }));

      // 🔥 CRITICAL FIX: Inform App.jsx that the database values have updated
      if (typeof onProfileUpdate === "function") {
        await onProfileUpdate();
      }

      setMessage({ text: "Profile updated successfully!", type: "success" });
      setIsEditing(false);
    }

    setLoading(false);
  };

  const handleCancelEdit = () => {
    setFormData({
      fullName: profile.fullName,
      username: profile.username,
      dietaryRequirements: profile.dietaryRequirements,
      budget: profile.budget,
    });
    setMessage({ text: "", type: "" });
    setIsEditing(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    onSignOut();
  };

  return (
    <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          Your Profile
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Manage your account details
        </p>
      </div>

      <div className="rounded-xl bg-gray-50 p-4 space-y-2 border border-gray-100 text-sm">
        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Email</span>
          <span className="col-span-2 text-gray-900 font-mono text-xs break-all">
            {session.user.email}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Full Name</span>
          <span className="col-span-2 text-gray-900 truncate">
            {profile.fullName || "—"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Username</span>
          <span className="col-span-2 text-gray-900 truncate">
            {profile.username ? `@${profile.username}` : "—"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Budget per meal</span>
          <span className="col-span-2 text-gray-900">£{profile.budget}</span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2">
          <span className="font-medium text-gray-500">Dietary</span>
          <span className="col-span-2 text-gray-900">
            {profile.dietaryRequirements.length > 0 ? (
              <span className="flex flex-wrap gap-1">
                {profile.dietaryRequirements.map((id) => {
                  const opt = DIETARY_OPTIONS.find((o) => o.id === id);

                  return opt ? (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 border border-blue-100"
                    >
                      {opt.emoji} {opt.label}
                    </span>
                  ) : null;
                })}
              </span>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      {!isEditing && (
        <button
          type="button"
          onClick={() => {
            setMessage({ text: "", type: "" });
            setIsEditing(true);
          }}
          className="w-full rounded-lg bg-blue-600 p-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none"
        >
          Edit details
        </button>
      )}

      {isEditing && (
        <>
          <hr className="border-gray-100" />

          <form onSubmit={handleUpdate} className="space-y-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
              Profile details
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Full Name
              </label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    fullName: e.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="Type full name..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    username: e.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="Type username..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Budget per meal
              </label>
              <input
                type="number"
                min="0"
                value={formData.budget}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    budget: Math.max(0, Number(e.target.value) || 0),
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="Enter meal budget..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Dietary Requirements
              </label>

              <div className="grid grid-cols-2 gap-2">
                {DIETARY_OPTIONS.map((option) => {
                  const isSelected = formData.dietaryRequirements.includes(
                    option.id
                  );

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleDietary(option.id)}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all focus:outline-none ${
                        isSelected
                          ? "border-blue-500 bg-blue-50 text-blue-700 shadow-sm"
                          : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <span className="text-base leading-none">{option.emoji}</span>
                      <span>{option.label}</span>

                      {isSelected && (
                        <span className="ml-auto flex h-4 w-4 items-center justify-center rounded-full bg-blue-500">
                          <svg
                            className="h-2.5 w-2.5 text-white"
                            fill="none"
                            viewBox="0 0 10 10"
                            stroke="currentColor"
                            strokeWidth={2.5}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M2 5l2.5 2.5L8 3"
                            />
                          </svg>
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 rounded-lg bg-blue-600 p-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none disabled:opacity-50"
              >
                {loading ? "Saving..." : "Save changes"}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={loading}
                className="flex-1 rounded-lg border border-gray-300 bg-white p-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </>
      )}

      {message.text && (
        <p
          className={`text-center text-sm ${
            message.type === "error" ? "text-red-600" : "text-green-600"
          }`}
        >
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

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";
import {
  ACTIVITY_LEVELS,
  GOAL_OPTIONS,
  getActivityLabel,
  getGoalLabel,
} from "../lib/nutrition";

const DIETARY_OPTIONS = [
  { id: "vegan", label: "Vegan", emoji: "🌱" },
  { id: "vegetarian", label: "Vegetarian", emoji: "🥦" },
  { id: "gluten-free", label: "Gluten-Free", emoji: "🌾" },
  { id: "dairy-free", label: "Dairy-Free", emoji: "🥛" },
  { id: "halal", label: "Halal", emoji: "☪️" },
  { id: "kosher", label: "Kosher", emoji: "✡️" },
];

const DEFAULT_BUDGET = 10;

function toFormProfile(data) {
  return {
    fullName: data?.full_name || "",
    username: data?.username || "",
    dietaryRequirements: data?.dietary_requirements || [],
    budget: data?.budget ?? DEFAULT_BUDGET,
    weightKg: data?.weight_kg ?? "",
    heightCm: data?.height_cm ?? "",
    age: data?.age ?? "",
    activityLevel: data?.activity_level || "moderate",
    goal: data?.goal || "maintenance",
  };
}

export default function ProfileView({
  session,
  initialProfile,
  onGuestProfileUpdate,
  onSignOut,
  onProfileUpdate,
}) {
  const isGuest = !session;
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  const [profile, setProfile] = useState(() => toFormProfile(initialProfile));

  const [formData, setFormData] = useState(() => toFormProfile(initialProfile));

  const startEditing = () => {
    setFormData(profile);
    setMessage({ text: "", type: "" });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setFormData(profile);
    setMessage({ text: "", type: "" });
    setIsEditing(false);
  };

  useEffect(() => {
    if (isGuest) {
      return undefined;
    }

    let isMounted = true;

    async function fetchProfile() {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "full_name, username, dietary_requirements, budget, weight_kg, height_cm, age, activity_level, goal"
        )
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
          budget: data.budget ?? DEFAULT_BUDGET,
          weightKg: data.weight_kg ?? "",
          heightCm: data.height_cm ?? "",
          age: data.age ?? "",
          activityLevel: data.activity_level || "moderate",
          goal: data.goal || "maintenance",
        });

        setFormData({
          fullName: data.full_name || "",
          username: data.username || "",
          dietaryRequirements: data.dietary_requirements || [],
          budget: data.budget ?? DEFAULT_BUDGET,
          weightKg: data.weight_kg ?? "",
          heightCm: data.height_cm ?? "",
          age: data.age ?? "",
          activityLevel: data.activity_level || "moderate",
          goal: data.goal || "maintenance",
        });
      }
    }

    fetchProfile();

    return () => {
      isMounted = false;
    };
  }, [isGuest, session]);

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
    const weightKg = formData.weightKg === "" ? null : Number(formData.weightKg);
    const heightCm = formData.heightCm === "" ? null : Number(formData.heightCm);
    const age = formData.age === "" ? null : Number(formData.age);
    const activityLevel = formData.activityLevel || "moderate";
    const goal = formData.goal || "maintenance";

    if (!isGuest && (!fullName || !username)) {
      setMessage({
        text: "Full name and username cannot be empty.",
        type: "error",
      });
      return;
    }

    if (
      (weightKg !== null && weightKg <= 0) ||
      (heightCm !== null && heightCm <= 0) ||
      (age !== null && age <= 0)
    ) {
      setMessage({
        text: "Weight, height, and age must be positive numbers.",
        type: "error",
      });
      return;
    }

    setLoading(true);
    setMessage({ text: "", type: "" });

    if (isGuest) {
      const updatedProfile = {
        full_name: profile.fullName || "Guest",
        username: profile.username || "guest",
        dietary_requirements: formData.dietaryRequirements,
        budget,
        weight_kg: weightKg,
        height_cm: heightCm,
        age,
        activity_level: activityLevel,
        goal,
      };

      setProfile(toFormProfile(updatedProfile));
      setFormData(toFormProfile(updatedProfile));

      if (typeof onGuestProfileUpdate === "function") {
        onGuestProfileUpdate(updatedProfile);
      }

      setMessage({ text: "Guest profile updated for this session.", type: "success" });
      setIsEditing(false);
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        username,
        dietary_requirements: formData.dietaryRequirements,
        budget,
        weight_kg: weightKg,
        height_cm: heightCm,
        age,
        activity_level: activityLevel,
        goal,
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
        weightKg,
        heightCm,
        age,
        activityLevel,
        goal,
      });

      setFormData((prev) => ({
        ...prev,
        fullName,
        username,
        budget,
        weightKg: weightKg ?? "",
        heightCm: heightCm ?? "",
        age: age ?? "",
        activityLevel,
        goal,
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

  const handleSignOut = async () => {
    if (!isGuest) {
      await supabase.auth.signOut();
    }
    onSignOut();
  };

  return (
    <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {isGuest ? "Guest Preferences" : "Your Profile"}
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          {isGuest ? "Set temporary preferences for this visit" : "Manage your account details"}
        </p>
      </div>

      <div className="rounded-xl bg-gray-50 p-4 space-y-2 border border-gray-100 text-sm">
        {!isGuest && (
          <>
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
          </>
        )}

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Budget per meal</span>
          <span className="col-span-2 text-gray-900">£{profile.budget}</span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Goal</span>
          <span className="col-span-2 text-gray-900">
            {getGoalLabel(profile.goal)}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Body</span>
          <span className="col-span-2 text-gray-900">
            {profile.weightKg && profile.heightCm && profile.age
              ? `${profile.weightKg}kg, ${profile.heightCm}cm, ${profile.age} years`
              : "—"}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-4 py-2 border-b border-gray-200">
          <span className="font-medium text-gray-500">Activity</span>
          <span className="col-span-2 text-gray-900">
            {getActivityLabel(profile.activityLevel)}
          </span>
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

      <hr className="border-gray-100" />

      {!isEditing ? (
        <button
          type="button"
          onClick={startEditing}
          className="w-full rounded-lg bg-blue-600 p-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none"
        >
          Edit details
        </button>
      ) : (
        <form onSubmit={handleUpdate} className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            Edit Details
          </h2>

          {!isGuest && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Update Full Name
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
                  placeholder="Type new full name..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Update Username
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
                  placeholder="Type new username..."
                />
              </div>
            </>
          )}

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
              placeholder="Enter budget per meal..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Personal Goal
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {GOAL_OPTIONS.map((option) => {
                const isSelected = formData.goal === option.id;

                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({ ...prev, goal: option.id }))
                    }
                    className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-all focus:outline-none ${
                      isSelected
                        ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                        : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Weight (kg)
              </label>
              <input
                type="number"
                min="1"
                step="0.1"
                value={formData.weightKg}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    weightKg: e.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="70"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Height (cm)
              </label>
              <input
                type="number"
                min="1"
                step="0.1"
                value={formData.heightCm}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    heightCm: e.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="175"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Age
              </label>
              <input
                type="number"
                min="1"
                step="1"
                value={formData.age}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    age: e.target.value,
                  }))
                }
                className="mt-2 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="30"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Activity Level
            </label>
            <select
              value={formData.activityLevel}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  activityLevel: e.target.value,
                }))
              }
              className="mt-2 w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            >
              {ACTIVITY_LEVELS.map((level) => (
                <option key={level.id} value={level.id}>
                  {level.label}
                </option>
              ))}
            </select>
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

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={cancelEditing}
              disabled={loading}
              className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 p-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none disabled:opacity-50"
            >
              {loading ? "Saving..." : "Save changes"}
            </button>
          </div>
        </form>
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
        {isGuest ? "Exit guest mode" : "Sign out"}
      </button>
    </div>
  );
}

ProfileView.propTypes = {
  session: PropTypes.shape({
    user: PropTypes.shape({
      email: PropTypes.string,
      id: PropTypes.string.isRequired,
    }).isRequired,
  }),
  initialProfile: PropTypes.shape({
    full_name: PropTypes.string,
    username: PropTypes.string,
    dietary_requirements: PropTypes.arrayOf(PropTypes.string),
    budget: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    weight_kg: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    height_cm: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    age: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
    activity_level: PropTypes.string,
    goal: PropTypes.string,
  }),
  onGuestProfileUpdate: PropTypes.func,
  onSignOut: PropTypes.func.isRequired,
  onProfileUpdate: PropTypes.func,
};

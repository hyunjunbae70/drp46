import { useState } from "react";
import PropTypes from "prop-types";
import { supabase } from "../lib/supabase";

// Metric tracking functionality
import { startJourney } from "../analytics";

export default function AuthView({ onContinueAsGuest }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    fullName: "",
    username: "",
  });

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleAuth = async (event) => {
    event.preventDefault();
    setLoading(true);
    setMessage({ text: "", type: "" });

    if (isSignUp) {
      // Sign Up Flow
      const { data, error } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
      });

      if (error) {
        setMessage({ text: error.message, type: "error" });
        setLoading(false);
        return;
      }

      if (data.user) {
        const { error: profileError } = await supabase.from("profiles").insert({
          id: data.user.id,
          full_name: formData.fullName,
          username: formData.username,
        });

        if (profileError) {
          setMessage({ text: profileError.message, type: "error" });
        } else {
          setMessage({ text: "Account created successfully!", type: "success" });
          startJourney();
        }
      }
    } else {
      // Sign In Flow
      const { error } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      
      if (!error) {
        startJourney();
      }
      if (error) setMessage({ text: error.message, type: "error" });
    }
    setLoading(false);
  };

  return (
    <div className="w-full max-w-md space-y-6 rounded-2xl bg-white p-8 shadow-sm border border-gray-100">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">
          {isSignUp ? "Create an account" : "Welcome Back"}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {isSignUp ? "Sign up to get started" : "Sign in to manage your profile"}
        </p>
      </div>

      <form onSubmit={handleAuth} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">Email address</label>
          <input
            name="email"
            type="email"
            required
            value={formData.email}
            onChange={handleChange}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Password</label>
          <input
            name="password"
            type="password"
            required
            value={formData.password}
            onChange={handleChange}
            className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
            placeholder="••••••••"
          />
        </div>

        {isSignUp && (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700">Full Name</label>
              <input
                name="fullName"
                type="text"
                value={formData.fullName}
                onChange={handleChange}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Username</label>
              <input
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                className="mt-1 w-full rounded-lg border border-gray-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="johndoe"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 p-2.5 text-sm font-semibold text-white hover:bg-blue-700 focus:outline-none disabled:opacity-50"
        >
          {loading ? "Processing..." : isSignUp ? "Sign up" : "Log in"}
        </button>
      </form>

      {message.text && (
        <p className={`text-center text-sm ${message.type === "error" ? "text-red-600" : "text-green-600"}`}>
          {message.text}
        </p>
      )}

      <div className="text-center">
        <button
          type="button"
          onClick={() => {
            setIsSignUp(!isSignUp);
            setMessage({ text: "", type: "" });
          }}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          {isSignUp ? "Already have an account? Log in" : "Don't have an account? Sign up"}
        </button>
      </div>

      {typeof onContinueAsGuest === "function" && (
        <button
          type="button"
          onClick={onContinueAsGuest}
          className="w-full rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 focus:outline-none"
        >
          Continue as guest
        </button>
      )}
    </div>
  );
}

AuthView.propTypes = {
  onContinueAsGuest: PropTypes.func,
};

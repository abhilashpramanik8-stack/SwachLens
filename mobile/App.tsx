import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import Constants from "expo-constants";
import { Picker } from "@react-native-picker/picker";

type Screen =
  | "home"
  | "userAuth"
  | "forgotPassword"
  | "user"
  | "report"
  | "campusDetails"
  | "details"
  | "adminLogin"
  | "admin"
  | "campusMap";
type AuthMode = "login" | "register";
type AdminFilter = "all" | "pending" | "in_process" | "resolved";
type AdminSection = "dashboard" | "issues" | "campuses" | "playbook";
type Coordinates = { latitude: number; longitude: number };
type Campus = Coordinates & {
  id: string;
  number: number;
  name: string;
  radiusMeters: number;
  active: boolean;
  locationQuality?: string;
};
type PhotoAsset = ImagePicker.ImagePickerAsset & { file?: any };
type UserProfile = {
  id: string;
  name: string;
  email: string;
  phone: string;
  createdAt: string;
};
type Issue = {
  id: string;
  referenceId: string;
  campusId: string;
  latitude: number;
  longitude: number;
  category: string;
  volumeClass: string;
  severity: number;
  priority: number;
  status: string;
  reportCount: number;
  etaMinutes?: number;
  estimatedResponseMinutes?: number;
  crewEtaMinutes?: number;
  distanceToAdminKm?: number;
  distanceToCrewKm?: number;
  crewId?: string;
  aiExplanation: string;
  imageUrl?: string;
  duplicateOf?: string;
  duplicateMessage?: string;
  aiProvider?: string;
  intervention?: { intervention: string; actions: string[]; crewTypes: string[]; escalate?: string };
  recommendedCrewTypes?: string[];
  matchingCrews?: { id: string; name: string; capability: string; workers: number; specialties?: string[] }[];
};

type ThemeMode = "light" | "dark";

type Palette = {
  ink: string;
  muted: string;
  green: string;
  onPrimary: string;
  primarySubtitle: string;
  mint: string;
  gold: string;
  red: string;
  paper: string;
  surface: string;
  panel: string;
  panelText: string;
  panelMuted: string;
  line: string;
  blue: string;
  map: string;
  mapRoad: string;
  warningSurface: string;
  warningText: string;
};

const lightTheme: Palette = {
  ink: "#17232f",
  muted: "#6c7b87",
  green: "#3d8b70",
  onPrimary: "#ffffff",
  primarySubtitle: "#dff2e8",
  mint: "#e9f5ef",
  gold: "#f4b860",
  red: "#d76457",
  paper: "#f7fbf8",
  surface: "#ffffff",
  panel: "#17232f",
  panelText: "#ffffff",
  panelMuted: "#c8d7d0",
  line: "#d9e2dc",
  blue: "#668cc4",
  map: "#dceee5",
  mapRoad: "#b9d4c6",
  warningSurface: "#fff4df",
  warningText: "#996a1e",
};

const darkTheme: Palette = {
  ink: "#eef7f2",
  muted: "#a8b8b1",
  green: "#63c596",
  onPrimary: "#062015",
  primarySubtitle: "#d8fae8",
  mint: "#233c32",
  gold: "#f4c978",
  red: "#f18475",
  paper: "#101a17",
  surface: "#1a2924",
  panel: "#0c1914",
  panelText: "#f1fff8",
  panelMuted: "#b8d4c6",
  line: "#334b41",
  blue: "#8fb2e4",
  map: "#203a32",
  mapRoad: "#385b4d",
  warningSurface: "#3b301d",
  warningText: "#ffd88a",
};

type ThemeContextValue = {
  mode: ThemeMode;
  theme: Palette;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: "light",
  theme: lightTheme,
  toggleTheme: () => undefined,
});

function useTheme() {
  return useContext(ThemeContext);
}

function resolveApiUrl() {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined")
    return `http://${window.location.hostname}:5050/api`;
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri?.split(":")[0];
  if (host && !["localhost", "127.0.0.1"].includes(host))
    return `http://${host}:5050/api`;
  if (Platform.OS === "android") return "http://10.0.2.2:5050/api";
  return "http://localhost:5050/api";
}

const API = resolveApiUrl();

function errorText(error: any) {
  if (error?.response?.data?.message) return error.response.data.message;
  if (/network|failed to fetch|fetch failed/i.test(error?.message || ""))
    return `Cannot reach the backend at ${API}. Start the backend and keep the phone and computer on the same Wi-Fi.`;
  return error?.message || "Something went wrong. Please try again.";
}

function mediaUrl(url?: string) {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API.replace(/\/api\/?$/, "")}${url}`;
}

function matchesAdminFilter(status: string, filter: AdminFilter) {
  if (filter === "all") return true;
  if (filter === "resolved") return status === "resolved";
  if (filter === "pending")
    return ["reported", "analyzing", "analyzed"].includes(status);
  return ["assigned", "en_route", "on_site"].includes(status);
}

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.message || `Request failed (${response.status})`);
  return payload;
}

function AppContent() {
  const { mode, theme, toggleTheme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [screen, setScreen] = useState<Screen>("home");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [issue, setIssue] = useState<Issue>();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [campus, setCampus] = useState("C01");
  const [photo, setPhoto] = useState<PhotoAsset>();
  const [description, setDescription] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<Coordinates>();
  const [locationMessage, setLocationMessage] = useState(
    "The selected campus pin will be used if GPS is unavailable.",
  );
  const [userToken, setUserToken] = useState("");
  const [userProfile, setUserProfile] = useState<UserProfile>();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [resetIdentifier, setResetIdentifier] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetCodeHint, setResetCodeHint] = useState("");
  const [resetRequested, setResetRequested] = useState(false);
  const [adminUser, setAdminUser] = useState("admin");
  const [adminPass, setAdminPass] = useState("admin123");
  const [adminToken, setAdminToken] = useState("");
  const [adminData, setAdminData] = useState<any>();
  const [adminFilter, setAdminFilter] = useState<AdminFilter>("all");
  const [adminSection, setAdminSection] = useState<AdminSection>("dashboard");
  const [previewImage, setPreviewImage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [backendOk, setBackendOk] = useState<boolean>();

  const selectedCampus = useMemo(
    () => campuses.find((item) => item.id === campus),
    [campuses, campus],
  );

  useEffect(() => {
    jsonRequest("/health")
      .then(() => setBackendOk(true))
      .catch(() => setBackendOk(false));
    jsonRequest("/campuses")
      .then((data) => setCampuses(data))
      .catch(() => setCampuses([]));
  }, []);

  useEffect(() => {
    if (screen === "user" && userToken)
      jsonRequest("/user/issues", {
        headers: { Authorization: `Bearer ${userToken}` },
      })
        .then(setIssues)
        .catch(() => setIssues([]));
  }, [screen, userToken]);

  const captureLocation = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setLocationMessage(
          "Location permission denied. The selected campus pin will still be submitted.",
        );
        return undefined;
      }
      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
      };
      setDeviceLocation(next);
      setLocationMessage(
        `GPS captured: ${next.latitude.toFixed(5)}, ${next.longitude.toFixed(5)}`,
      );
      return next;
    } catch {
      setLocationMessage(
        "GPS is unavailable. The selected campus pin will be submitted instead.",
      );
      return undefined;
    }
  };

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted)
      return Alert.alert(
        "Photo permission needed",
        "Allow photo access in Expo Go, then try again.",
      );
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.75,
    });
    if (!result.canceled) setPhoto(result.assets[0] as PhotoAsset);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted)
      return Alert.alert(
        "Camera permission needed",
        "Allow camera access in Expo Go, then try again.",
      );
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.75,
      cameraType: ImagePicker.CameraType.back,
    });
    if (!result.canceled) setPhoto(result.assets[0] as PhotoAsset);
  };

  const submit = async () => {
    if (!photo)
      return Alert.alert(
        "Photo required",
        "Upload a photo or take one directly in the app.",
      );
    if (
      !selectedCampus ||
      selectedCampus.latitude === 0 ||
      selectedCampus.longitude === 0
    )
      return Alert.alert(
        "Campus location unavailable",
        "This campus has no configured coordinates yet.",
      );
    setBusy(true);
    try {
      const gps = deviceLocation || (await captureLocation());
      const location = gps || {
        latitude: selectedCampus.latitude,
        longitude: selectedCampus.longitude,
      };
      const form = new FormData();
      form.append("campusId", campus);
      form.append("latitude", String(location.latitude));
      form.append("longitude", String(location.longitude));
      form.append("description", description.trim());
      // Leave Content-Type unset for FormData so fetch adds the multipart boundary.
      if (Platform.OS === "web") {
        const browserFile =
          photo.file || (await (await fetch(photo.uri)).blob());
        form.append("photo", browserFile as any, photo.fileName || "issue.jpg");
      } else {
        form.append("photo", {
          uri: photo.uri,
          name: photo.fileName || "issue.jpg",
          type: photo.mimeType || "image/jpeg",
        } as any);
      }
      const data = await jsonRequest("/issues", {
        method: "POST",
        headers: { Authorization: `Bearer ${userToken}` },
        body: form,
      });
      setIssue(data);
      setPhoto(undefined);
      setDescription("");
      setScreen("details");
    } catch (error: any) {
      Alert.alert("Could not submit issue", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const authenticateUser = async () => {
    setBusy(true);
    try {
      const data =
        authMode === "register"
          ? await jsonRequest("/auth/register", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, email, phone, password }),
            })
          : await jsonRequest("/auth/user-login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ identifier, password }),
            });
      setUserToken(data.token);
      setUserProfile(data.user);
      setPassword("");
      setScreen("user");
    } catch (error: any) {
      Alert.alert(
        authMode === "register"
          ? "Could not create account"
          : "User login failed",
        errorText(error),
      );
    } finally {
      setBusy(false);
    }
  };

  const requestPasswordReset = async () => {
    if (!resetIdentifier.trim())
      return Alert.alert("Email or phone required", "Enter the value used when you created your account.");
    setBusy(true);
    try {
      const data = await jsonRequest("/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier: resetIdentifier.trim() }),
      });
      setResetRequested(true);
      setResetCodeHint(
        data.demoCode
          ? `Demo verification code: ${data.demoCode}`
          : "Check the email or phone linked to your account for the verification code.",
      );
    } catch (error: any) {
      Alert.alert("Could not start password reset", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const resetPasswordWithCode = async () => {
    if (!resetCode || !resetPassword)
      return Alert.alert("Details required", "Enter the verification code and a new password.");
    setBusy(true);
    try {
      await jsonRequest("/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: resetIdentifier.trim(),
          code: resetCode.trim(),
          newPassword: resetPassword,
        }),
      });
      Alert.alert("Password updated", "You can now sign in with your new password.");
      setIdentifier(resetIdentifier.trim());
      setResetCode("");
      setResetPassword("");
      setResetCodeHint("");
      setResetRequested(false);
      setScreen("userAuth");
    } catch (error: any) {
      Alert.alert("Could not reset password", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const loginAdmin = async () => {
    if (!adminUser.trim() || !adminPass)
      return Alert.alert(
        "Missing credentials",
        "Enter the administrator username and password.",
      );
    setBusy(true);
    try {
      const auth = await jsonRequest("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: adminUser.trim(),
          password: adminPass,
        }),
      });
      const data = await jsonRequest("/admin/dashboard", {
        headers: { Authorization: `Bearer ${auth.token}` },
      });
      setAdminToken(auth.token);
      setAdminData(data);
      setScreen("admin");
    } catch (error: any) {
      Alert.alert("Administrator login failed", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const refreshAdmin = async () =>
    setAdminData(
      await jsonRequest("/admin/dashboard", {
        headers: { Authorization: `Bearer ${adminToken}` },
      }),
    );
  const act = async (id: string, status?: string, crewId?: string) => {
    setBusy(true);
    try {
      const headers = {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json",
      };
      if (status)
        await jsonRequest(`/admin/issues/${id}/status`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ status }),
        });
      else
        await jsonRequest(`/admin/issues/${id}/assign`, {
          method: "POST",
          headers,
          body: JSON.stringify(crewId ? { crewId } : {}),
        });
      await refreshAdmin();
    } catch (error: any) {
      Alert.alert("Operation failed", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const removeResolvedIssue = async (id: string) => {
    setBusy(true);
    try {
      await jsonRequest(`/admin/issues/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      await refreshAdmin();
    } catch (error: any) {
      Alert.alert("Could not remove issue", errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const adminIssues = useMemo(
    () =>
      (adminData?.issues || []).filter((item: Issue) =>
        matchesAdminFilter(item.status, adminFilter),
      ),
    [adminData, adminFilter],
  );

  const logoutUser = () => {
    setUserToken("");
    setUserProfile(undefined);
    setIssues([]);
    setScreen("home");
  };

  if (screen === "home")
    return (
      <Shell>
        <View style={styles.hero}>
          <Image
            source={require("./assets/swachhlens-logo.png")}
            style={styles.appLogo}
            accessibilityLabel="SwachhLens logo"
          />
          <Text style={styles.eyebrow}>KIIT BHUBANESWAR</Text>
          <Text style={styles.logo}>SWACHHLENS</Text>
          <Text style={styles.tag}>
            A cleaner campus, one response at a time.
          </Text>
        </View>
        <View style={styles.connection}>
          <View
            style={[
              styles.connectionDot,
              { backgroundColor: backendOk ? theme.green : theme.red },
            ]}
          />
          <Text style={styles.connectionText}>
            {backendOk
              ? `Backend connected · ${API}`
              : `Backend not reachable · ${API}`}
          </Text>
        </View>
        <Button
          label="Local User"
          subtitle="Report and track cleanliness issues"
          onPress={() => {
            setAuthMode("login");
            setScreen("userAuth");
          }}
          primary
        />
        <Button
          label="Administrator"
          subtitle="Manage response operations"
          onPress={() => setScreen("adminLogin")}
        />
        <Text style={styles.note}>
          Every local user creates an account so reports remain secure and
          auditable.
        </Text>
      </Shell>
    );

  if (screen === "userAuth")
    return (
      <Shell title="Local User">
        <Card
          title={
            authMode === "register" ? "Create your account" : "Welcome back"
          }
        >
          <Text style={styles.body}>
            {authMode === "register"
              ? "Your account keeps your reports and cleanup updates together."
              : "Sign in to submit a report and follow its response."}
          </Text>
          <View style={styles.segment}>
            <Pressable
              onPress={() => setAuthMode("login")}
              style={[
                styles.segmentButton,
                authMode === "login" && styles.segmentActive,
              ]}
            >
              <Text
                style={
                  authMode === "login"
                    ? styles.segmentTextActive
                    : styles.segmentText
                }
              >
                Sign in
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setAuthMode("register")}
              style={[
                styles.segmentButton,
                authMode === "register" && styles.segmentActive,
              ]}
            >
              <Text
                style={
                  authMode === "register"
                    ? styles.segmentTextActive
                    : styles.segmentText
                }
              >
                Create account
              </Text>
            </Pressable>
          </View>
          {authMode === "register" ? (
            <>
              <Field
                label="Full name"
                value={name}
                onChangeText={setName}
                placeholder="Your name"
              />
              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
              />
              <Field
                label="Phone"
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                keyboardType="phone-pad"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="At least 6 characters"
                secureTextEntry
              />
            </>
          ) : (
            <>
              <Field
                label="Email or phone"
                value={identifier}
                onChangeText={setIdentifier}
                placeholder="you@example.com"
                autoCapitalize="none"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                secureTextEntry
              />
            </>
          )}
          <Button
            label={
              busy
                ? "Please wait..."
                : authMode === "register"
                  ? "Create account"
                  : "Sign in"
            }
            onPress={authenticateUser}
            primary
            disabled={busy}
          />
          {authMode === "login" && (
            <Pressable
              onPress={() => {
                setResetIdentifier(identifier);
                setResetRequested(false);
                setResetCodeHint("");
                setScreen("forgotPassword");
              }}
            >
              <Text style={styles.link}>Forgot password?</Text>
            </Pressable>
          )}
        </Card>
        <Button label="Back to start" onPress={() => setScreen("home")} />
      </Shell>
    );

  if (screen === "forgotPassword")
    return (
      <Shell title="Recover account">
        <Card title="Forgot password">
          <Text style={styles.body}>
            Use the email or phone number saved on your account. The verification
            code is valid for 15 minutes.
          </Text>
          <Field
            label="Email or phone"
            value={resetIdentifier}
            onChangeText={setResetIdentifier}
            placeholder="you@example.com or +91..."
            autoCapitalize="none"
          />
          <Button
            label={busy ? "Sending..." : "Send verification code"}
            onPress={requestPasswordReset}
            primary
            disabled={busy}
          />
          {resetRequested && (
            <>
              <View style={styles.duplicateNotice}>
                <Text style={styles.duplicateTitle}>{resetCodeHint}</Text>
                <Text style={styles.body}>
                  In production, connect an email/SMS provider to deliver this code.
                </Text>
              </View>
              <Field
                label="6-digit verification code"
                value={resetCode}
                onChangeText={setResetCode}
                placeholder="123456"
                keyboardType="number-pad"
              />
              <Field
                label="New password"
                value={resetPassword}
                onChangeText={setResetPassword}
                placeholder="At least 6 characters"
                secureTextEntry
              />
              <Button
                label={busy ? "Updating..." : "Update password"}
                onPress={resetPasswordWithCode}
                primary
                disabled={busy}
              />
            </>
          )}
        </Card>
        <Button label="Back to sign in" onPress={() => setScreen("userAuth")} />
      </Shell>
    );

  if (screen === "user")
    return (
      <Shell title="Local User">
        <View style={styles.welcome}>
          <Text style={styles.welcomeSmall}>SIGNED IN AS</Text>
          <Text style={styles.welcomeName}>
            {userProfile?.name || "KIIT user"}
          </Text>
          <Text style={styles.welcomeEmail}>{userProfile?.email}</Text>
        </View>
        <View style={styles.kpis}>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{issues.length}</Text>
            <Text style={styles.kpiLabel}>My reports</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{issues.filter((item) => item.status === "resolved").length}</Text>
            <Text style={styles.kpiLabel}>Resolved</Text>
          </View>
          <View style={styles.kpi}>
            <Text style={styles.kpiValue}>{issues.filter((item) => item.status !== "resolved").length}</Text>
            <Text style={styles.kpiLabel}>In progress</Text>
          </View>
        </View>
        <View style={styles.actionGrid}>
          <ActionCard
            title="Report issue"
            caption="Photo + location"
            onPress={() => setScreen("report")}
            primary
          />
          <ActionCard
            title="Campus directory"
            caption="View campus details"
            onPress={() => setScreen("campusMap")}
          />
        </View>
        <View style={styles.menuBar}>
          <Pressable style={[styles.menuButton, styles.menuButtonActive]}>
            <Text style={[styles.menuText, styles.menuTextActive]}>Reports</Text>
          </Pressable>
          <Pressable
            style={styles.menuButton}
            onPress={() => setScreen("campusMap")}
          >
            <Text style={styles.menuText}>Campuses</Text>
          </Pressable>
          <Pressable
            style={styles.menuButton}
            onPress={() => setScreen("report")}
          >
            <Text style={styles.menuText}>New report</Text>
          </Pressable>
        </View>
        <Section title="My reports" />
        {issues.length ? (
          issues.slice(0, 8).map((item) => (
            <IssueRow
              key={item.id}
              i={item}
              onPress={() => {
                setIssue(item);
                setScreen("details");
              }}
            />
          ))
        ) : (
          <Card>
            <Text style={styles.body}>
              No reports yet. Your submitted issues will appear here with their
              response estimate and live status.
            </Text>
          </Card>
        )}
        <Button label="Sign out" onPress={logoutUser} />
      </Shell>
    );

  if (screen === "report")
    return (
      <Shell title="Report an issue">
        <Card title="Capture the issue">
          <View style={styles.photo}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.preview} />
            ) : (
              <Text style={styles.photoText}>Add evidence</Text>
            )}
          </View>
          <View style={styles.photoActions}>
            <Pressable onPress={pickFromLibrary} style={styles.photoAction}>
              <Text style={styles.photoActionText}>Upload photo</Text>
            </Pressable>
            <Pressable onPress={takePhoto} style={styles.photoAction}>
              <Text style={styles.photoActionText}>Take photo</Text>
            </Pressable>
          </View>
          <Text style={styles.label}>Campus number</Text>
          <View style={styles.picker}>
            <Picker selectedValue={campus} onValueChange={setCampus}>
              {campuses.map((item) => (
                <Picker.Item key={item.id} label={item.name} value={item.id} />
              ))}
            </Picker>
          </View>
          <CampusMap campus={selectedCampus} userLocation={deviceLocation} />
          <Text style={styles.mapCaption}>
            {selectedCampus?.name} ·{" "}
            {selectedCampus
              ? `${selectedCampus.latitude.toFixed(5)}, ${selectedCampus.longitude.toFixed(5)}`
              : "Loading campus location"}
            {selectedCampus?.locationQuality === "approximate"
              ? " · zone pin"
              : ""}
          </Text>
          <Button label="Use my current location" onPress={captureLocation} />
          <Text style={styles.hint}>{locationMessage}</Text>
          <Text style={styles.label}>Optional description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Overflowing bin, plastic near drain..."
            multiline
            style={[styles.input, { height: 90 }]}
          />
          <Text style={styles.hint}>
            One active issue is tracked per campus. Additional reports are
            retained and counted as duplicates.
          </Text>
          <Button
            label={busy ? "Submitting..." : "Submit issue"}
            onPress={submit}
            primary
            disabled={busy}
          />
          <Button
            label="Cancel"
            onPress={() => setScreen("user")}
            disabled={busy}
          />
        </Card>
      </Shell>
    );

  if (screen === "campusMap")
    return (
      <Shell title="Campus directory">
        <Card title="Choose a campus to view details">
          <Text style={styles.body}>
            Browse the KIIT campus list, open its coordinate details, or start a
            report directly for that campus.
          </Text>
          <View style={styles.campusList}>
            {campuses.map((item) => (
              <Pressable
                key={item.id}
                style={styles.campusListRow}
                onPress={() => {
                  setCampus(item.id);
                  setScreen("campusDetails");
                }}
              >
                <View style={styles.campusNumber}>
                  <Text style={styles.campusNumberText}>{item.number}</Text>
                </View>
                <View style={styles.campusListCopy}>
                  <Text style={styles.campusListTitle}>{item.name}</Text>
                  <Text style={styles.campusListMeta}>
                    {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                  </Text>
                </View>
                <Text style={styles.campusChevron}>›</Text>
              </Pressable>
            ))}
          </View>
        </Card>
        <Button label="Back" onPress={() => setScreen("user")} />
      </Shell>
    );

  if (screen === "campusDetails")
    return (
      <Shell title={selectedCampus?.name || "Campus details"}>
        {selectedCampus ? (
          <>
            <Card title={`Campus ${selectedCampus.number}`}>
              <CampusMap campus={selectedCampus} />
              <Text style={styles.mapCaption}>
                Coordinate pin · {selectedCampus.latitude.toFixed(5)},{" "}
                {selectedCampus.longitude.toFixed(5)}
              </Text>
              <Stat label="Campus number" value={String(selectedCampus.number)} />
              <Stat label="Campus ID" value={selectedCampus.id} />
              <Stat
                label="Location radius"
                value={`${selectedCampus.radiusMeters} metres`}
              />
              <Stat
                label="Location quality"
                value={selectedCampus.locationQuality || "configured"}
              />
            </Card>
            <Button
              label="Report an issue here"
              onPress={() => setScreen("report")}
              primary
            />
          </>
        ) : (
          <Card>
            <Text style={styles.body}>Campus details are still loading.</Text>
          </Card>
        )}
        <Button label="Back to campus directory" onPress={() => setScreen("campusMap")} />
      </Shell>
    );

  if (screen === "details" && issue) {
    const issueCampus = campuses.find((item) => item.id === issue.campusId);
    return (
      <Shell title="Issue tracking">
        <Card title={issue.referenceId}>
          <View style={styles.status}>
            <Text style={styles.statusDot}>●</Text>
            <Text style={styles.statusText}>
              {issue.status.replace("_", " ").toUpperCase()}
            </Text>
          </View>
          <CampusMap
            campus={issueCampus}
            userLocation={{
              latitude: issue.latitude,
              longitude: issue.longitude,
            }}
          />
          {issue.duplicateMessage && (
            <View style={styles.duplicateNotice}>
              <Text style={styles.duplicateTitle}>Duplicate report linked</Text>
              <Text style={styles.body}>{issue.duplicateMessage}</Text>
            </View>
          )}
          <Stat label="Campus" value={issue.campusId} />
          <Stat
            label="Waste category"
            value={issue.category.replace("_", " ")}
          />
          <Stat
            label="Volume estimate"
            value={issue.volumeClass.replace("_", " ")}
          />
          <Stat
            label="Severity / priority"
            value={`${issue.severity} / ${issue.priority}`}
          />
          <Stat
            label="Reports at this campus"
            value={String(issue.reportCount)}
          />
          <Stat
            label="Distance from admin base"
            value={
              issue.distanceToAdminKm != null
                ? `${issue.distanceToAdminKm} km`
                : "—"
            }
          />
          <Stat
            label="Estimated response"
            value={`${issue.estimatedResponseMinutes || issue.etaMinutes || "—"} minutes`}
          />
          {issue.crewId && (
            <>
              <Stat label="Assigned crew" value={issue.crewId} />
              <Stat
                label="Crew ETA"
                value={`${issue.crewEtaMinutes || issue.etaMinutes || "—"} minutes`}
              />
            </>
          )}
          <Text style={styles.explain}>{issue.aiExplanation}</Text>
        </Card>
        <Button
          label="Refresh status"
          onPress={async () => {
            try {
              setIssue(await jsonRequest(`/issues/${issue.id}`));
            } catch (error: any) {
              Alert.alert("Refresh failed", errorText(error));
            }
          }}
          primary
        />
        <Button label="Back to my reports" onPress={() => setScreen("user")} />
      </Shell>
    );
  }

  if (screen === "adminLogin")
    return (
      <Shell title="Administrator">
        <Card title="Operations access">
          <Text style={styles.hint}>
            Backend: {backendOk ? "connected" : "not reachable"} · {API}
          </Text>
          <Field
            label="Username"
            value={adminUser}
            onChangeText={setAdminUser}
            autoCapitalize="none"
          />
          <Field
            label="Password"
            value={adminPass}
            onChangeText={setAdminPass}
            secureTextEntry
            autoCapitalize="none"
          />
          <Button
            label={busy ? "Signing in..." : "Open dashboard"}
            onPress={loginAdmin}
            primary
            disabled={busy}
          />
        </Card>
        <Button label="Back" onPress={() => setScreen("home")} />
      </Shell>
    );

  return (
    <Shell title="Operations dashboard">
      <View style={styles.adminHeader}>
        <View>
          <Text style={styles.welcomeSmall}>LIVE OPERATIONS</Text>
          <Text style={styles.adminTitle}>KIIT response desk</Text>
          {adminData?.adminPosition && (
            <Text style={styles.hint}>
              Admin base: {adminData.adminPosition.campusId} ·{" "}
              {adminData.adminPosition.latitude.toFixed(5)},{" "}
              {adminData.adminPosition.longitude.toFixed(5)}
            </Text>
          )}
        </View>
        <Pressable onPress={refreshAdmin} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </View>
      <View style={styles.kpis}>
        {[
          ["Active", adminData?.kpis.active || 0],
          ["Severe", adminData?.kpis.severe || 0],
          ["Duplicates", adminData?.kpis.duplicates || 0],
          ["Users", adminData?.kpis.users || 0],
        ].map((item) => (
          <View style={styles.kpi} key={String(item[0])}>
            <Text style={styles.kpiValue}>{item[1]}</Text>
            <Text style={styles.kpiLabel}>{item[0]}</Text>
          </View>
        ))}
      </View>
      <View style={styles.adminSectionTabs}>
        {([["dashboard", "Overview"], ["issues", "Issues"], ["campuses", "Campuses"], ["playbook", "Playbook"]] as [AdminSection, string][]).map(([section, label]) => (
          <Pressable key={section} onPress={() => setAdminSection(section)} style={[styles.adminSectionTab, adminSection === section && styles.adminSectionTabActive]}>
            <Text style={[styles.adminSectionText, adminSection === section && styles.adminSectionTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {adminSection === "playbook" && (
        <Card title="Waste classification & response playbook">
          <Text style={styles.body}>Use these categories to route each report to the right operational team.</Text>
          <View style={styles.detailGrid}>
            {(adminData?.wasteCategories || []).map((category: any) => (
              <View key={category.id} style={styles.playbookItem}>
                <Text style={styles.playbookLabel}>{category.label}</Text>
                <Text style={styles.playbookGroup}>{category.group} · AI category</Text>
                <Text style={styles.hint}>{(category.crewTypes || []).join(" + ")}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}
      {adminSection === "dashboard" && (
        <Card title="Operations at a glance">
          <Text style={styles.body}>
            Monitor incoming reports, crew response, and campus hotspots from one place.
          </Text>
          <View style={styles.detailGrid}>
            <View style={styles.playbookItem}><Text style={styles.playbookLabel}>Reports received</Text><Text style={styles.kpiValue}>{adminData?.kpis.reports || 0}</Text></View>
            <View style={styles.playbookItem}><Text style={styles.playbookLabel}>Resolved</Text><Text style={styles.kpiValue}>{adminData?.kpis.resolved || 0}</Text></View>
          </View>
          <Button label="Open issue queue" onPress={() => setAdminSection("issues")} primary />
        </Card>
      )}
      {adminSection === "campuses" && <>
      <Card title="Campus operations map">
        <CampusMap
          campus={adminData?.campuses?.find((item: any) => item.id === "C25")}
          adminLocation={adminData?.adminPosition}
        />
        <Text style={styles.hint}>
          Blue A = admin operations desk · fixed to Campus 25 coordinates.
        </Text>
      </Card>
      <Section title="Campus hotspots" />
      {(adminData?.campuses || [])
        .filter((item: any) => item.activeIssues > 0)
        .slice(0, 5)
        .map((item: any) => (
          <View key={item.id} style={styles.hotspot}>
            <Text style={styles.hotspotTitle}>{item.name}</Text>
            <Text style={styles.hotspotMeta}>{item.activeIssues} active report(s)</Text>
          </View>
        ))}
      <Section title="Campus ETA plan" />
      {(adminData?.campuses || []).map((item: any) => (
        <View key={`eta-${item.id}`} style={styles.hotspot}>
          <Text style={styles.hotspotTitle}>{item.number}. {item.name}</Text>
          <Text style={styles.hotspotMeta}>{item.distanceToAdminKm} km · {item.estimatedResponseMinutes} min</Text>
        </View>
      ))}
      </>}
      {adminSection === "issues" && <>
      <View style={styles.adminTabs}>
        {([
          ["all", "All"],
          ["pending", "Pending"],
          ["in_process", "In process"],
          ["resolved", "Resolved"],
        ] as [AdminFilter, string][]).map(([filter, label]) => {
          const count = (adminData?.issues || []).filter((item: Issue) =>
            matchesAdminFilter(item.status, filter),
          ).length;
          return (
            <Pressable
              key={filter}
              onPress={() => setAdminFilter(filter)}
              style={[styles.adminTab, adminFilter === filter && styles.adminTabActive]}
            >
              <Text
                style={[
                  styles.adminTabText,
                  adminFilter === filter && styles.adminTabTextActive,
                ]}
              >
                {label} {count}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Section title="Live issue queue" />
      {adminIssues.length === 0 && (
        <Card>
          <Text style={styles.body}>
            No {adminFilter === "all" ? "issues" : adminFilter.replace("_", " ")} in this view.
          </Text>
        </Card>
      )}
      {adminIssues.map((item: Issue) => (
        <Card key={item.id} title={`${item.referenceId} · ${item.campusId}`}>
          {item.imageUrl && (
            <Pressable onPress={() => setPreviewImage(mediaUrl(item.imageUrl))} style={styles.issueImageButton} accessibilityRole="button" accessibilityLabel="Open report photo">
              <Image source={{ uri: mediaUrl(item.imageUrl) }} style={styles.issueImage} resizeMode="contain" />
              <View style={styles.imageOpenHint}><Text style={styles.imageOpenHintText}>Tap to open full photo</Text></View>
            </Pressable>
          )}
          <CampusMap
            campus={adminData?.campuses?.find(
              (item2: any) => item2.id === item.campusId,
            )}
            userLocation={{
              latitude: item.latitude,
              longitude: item.longitude,
            }}
            adminLocation={adminData?.adminPosition}
          />
          <Text style={styles.body}>
            {item.category} · severity {item.severity} · {item.reportCount}{" "}
            report(s) · estimate{" "}
            {item.estimatedResponseMinutes || item.etaMinutes || "—"} min
          </Text>
          {item.aiProvider && <Text style={styles.hint}>Vision provider: {item.aiProvider}</Text>}
          {item.intervention && <View style={styles.interventionCard}>
            <Text style={styles.interventionTitle}>Recommended intervention</Text>
            <Text style={styles.interventionMain}>{item.intervention.intervention}</Text>
            {item.intervention.actions.map((action: string) => <Text key={action} style={styles.interventionAction}>• {action}</Text>)}
            {item.intervention.escalate && <Text style={styles.reviewNotice}>{item.intervention.escalate}</Text>}
          </View>}
          {item.status === "analyzed" && (
            <View style={styles.crewPicker}>
              <Text style={styles.interventionTitle}>Playbook-matched crews</Text>
              <Text style={styles.hint}>{(item.recommendedCrewTypes || []).join(" · ")}</Text>
              {(item.matchingCrews || []).map((crew) => (
                <Button key={crew.id} label={`Assign ${crew.name} · ${crew.specialties?.join(", ") || crew.capability}`} onPress={() => act(item.id, undefined, crew.id)} primary disabled={busy} />
              ))}
            </View>
          )}
          <Text style={styles.hint}>
            {item.distanceToAdminKm ?? "—"} km from admin base
            {item.distanceToCrewKm != null
              ? ` · crew ${item.distanceToCrewKm} km away`
              : ""}
          </Text>
          <Text style={styles.badge}>{item.status}</Text>
          {item.status === "analyzed" && !(item.matchingCrews || []).length && (
            <Button
              label="Assign recommended crew"
              onPress={() => act(item.id)}
              primary
              disabled={busy}
            />
          )}
          {item.status === "assigned" && (
            <Button
              label="Mark en route"
              onPress={() => act(item.id, "en_route")}
              primary
              disabled={busy}
            />
          )}
          {item.status === "en_route" && (
            <Button
              label="Mark on site"
              onPress={() => act(item.id, "on_site")}
              primary
              disabled={busy}
            />
          )}
          {item.status === "on_site" && (
            <Button
              label="Resolve issue"
              onPress={() => act(item.id, "resolved")}
              primary
              disabled={busy}
            />
          )}
          {item.status === "resolved" && (
            <Button
              label="Remove resolved issue"
              onPress={() => removeResolvedIssue(item.id)}
              disabled={busy}
            />
          )}
        </Card>
      ))}
      </>}
      <Button label="Back to start" onPress={() => setScreen("home")} />
      <Modal visible={Boolean(previewImage)} transparent animationType="fade" onRequestClose={() => setPreviewImage(undefined)}>
        <View style={styles.imageModalBackdrop}>
          <Pressable onPress={() => setPreviewImage(undefined)} style={styles.imageModalClose} accessibilityRole="button" accessibilityLabel="Close photo"><Text style={styles.imageModalCloseText}>Close</Text></Pressable>
          {previewImage && <Image source={{ uri: previewImage }} style={styles.imageModalPhoto} resizeMode="contain" />}
        </View>
      </Modal>
    </Shell>
  );
}

/** Root component: restores and persists the selected visual theme. */
export default function App() {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    AsyncStorage.getItem("swachhlens.theme").then((savedMode) => {
      if (savedMode === "dark" || savedMode === "light") setMode(savedMode);
    });
  }, []);

  useEffect(() => {
    AsyncStorage.setItem("swachhlens.theme", mode).catch(() => undefined);
  }, [mode]);

  const toggleTheme = () =>
    setMode((currentMode) => (currentMode === "light" ? "dark" : "light"));
  const theme = mode === "dark" ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ mode, theme, toggleTheme }}>
      <AppContent />
    </ThemeContext.Provider>
  );
}

function CampusMap({
  campus,
  userLocation,
  adminLocation,
}: {
  campus?: Campus;
  userLocation?: Coordinates;
  adminLocation?: Coordinates;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const selected =
    campus && campus.latitude !== 0 && campus.longitude !== 0
      ? campus
      : { latitude: 20.354, longitude: 85.819, name: "KIIT Bhubaneswar" };
  const pinX = Math.min(
    90,
    Math.max(10, ((selected.longitude - 85.805) / 0.03) * 80 + 10),
  );
  const pinY = Math.min(
    88,
    Math.max(12, (1 - (selected.latitude - 20.345) / 0.022) * 76 + 12),
  );
  const positionFor = (location: Coordinates) => ({
    left: `${Math.min(90, Math.max(10, ((location.longitude - 85.805) / 0.03) * 80 + 10))}%` as `${number}%`,
    top: `${Math.min(88, Math.max(12, (1 - (location.latitude - 20.345) / 0.022) * 76 + 12))}%` as `${number}%`,
  });
  return (
    <View style={styles.dummyMap}>
      <View style={[styles.mapRoad, { left: "24%" }]} />
      <View style={[styles.mapRoad, { left: "58%" }]} />
      <View style={[styles.mapRoad, { top: "34%" }]} />
      <View style={[styles.mapRoad, { top: "68%" }]} />
      <View style={[styles.mapPin, { left: `${pinX}%`, top: `${pinY}%` }]}>
        <Text style={styles.mapPinText}>●</Text>
      </View>
      {adminLocation && (
        <View style={[styles.adminPin, positionFor(adminLocation)]}>
          <Text style={styles.adminPinText}>A</Text>
        </View>
      )}
      {userLocation && (
        <View
          style={[
            styles.reportPin,
            positionFor(userLocation),
          ]}
        >
          <Text style={styles.reportPinText}>●</Text>
        </View>
      )}
      <View style={styles.mapOverlay}>
        <Text style={styles.mapOverlayTitle}>{selected.name}</Text>
        <Text style={styles.mapOverlayText}>
          Campus coordinate pin · {selected.latitude.toFixed(5)},{" "}
          {selected.longitude.toFixed(5)}
        </Text>
      </View>
    </View>
  );
}

function Shell({
  children,
  title,
}: {
  children: React.ReactNode;
  title?: string;
}) {
  const { mode, toggleTheme, theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.container}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <View style={styles.brandRow}>
          <Image
            source={require("./assets/swachhlens-logo.png")}
            style={styles.headerLogo}
            accessibilityLabel="SwachhLens logo"
          />
          <Text style={styles.brand}>SWACHHLENS</Text>
        </View>
        <Pressable
          onPress={toggleTheme}
          accessibilityRole="button"
          accessibilityLabel="Toggle light and dark mode"
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            backgroundColor: theme.mint,
          }}
        >
          <Text style={{ color: theme.green, fontWeight: "800" }}>
            {mode === "dark" ? "☀ Light" : "☾ Dark"}
          </Text>
        </Pressable>
      </View>
      {title && <Text style={styles.title}>{title}</Text>}
      {children}
    </ScrollView>
  );
}

function Button({
  label,
  subtitle,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  subtitle?: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        primary && styles.primary,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.buttonCopy}>
        <Text style={[styles.buttonText, primary && styles.primaryText]}>
          {label}
        </Text>
        {subtitle && (
          <Text
            style={[styles.buttonSubtitle, primary && styles.primarySubtitle]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {disabled && label.includes("...") && (
        <ActivityIndicator color={primary ? theme.onPrimary : theme.green} />
      )}
    </Pressable>
  );
}

function ActionCard({
  title,
  caption,
  onPress,
  primary,
}: {
  title: string;
  caption: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <Pressable
      onPress={onPress}
      style={[styles.actionCard, primary && styles.actionCardPrimary]}
    >
      <Text style={[styles.actionTitle, primary && styles.primaryText]}>
        {title}
      </Text>
      <Text style={[styles.actionCaption, primary && styles.primarySubtitle]}>
        {caption}
      </Text>
    </Pressable>
  );
}

function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <View style={styles.card}>
      {title && <Text style={styles.cardTitle}>{title}</Text>}
      {children}
    </View>
  );
}

function Section({ title }: { title: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Text style={styles.section}>{title}</Text>;
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
}: any) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        placeholderTextColor={theme.muted}
        style={styles.input}
      />
    </View>
  );
}

function IssueRow({ i, onPress }: { i: Issue; onPress: () => void }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View>
        <Text style={styles.rowTitle}>{i.referenceId}</Text>
        <Text style={styles.rowMeta}>
          {i.campusId} · {i.category} · {i.reportCount} report(s) · ETA{" "}
          {i.estimatedResponseMinutes || i.etaMinutes || "—"} min
        </Text>
      </View>
      <Text style={styles.rowStatus}>{i.status.replace("_", " ")}</Text>
    </Pressable>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function createStyles(theme: Palette) {
  const colors = theme;
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.paper },
    container: {
      padding: 24,
      maxWidth: 820,
      width: "100%",
      alignSelf: "center",
      gap: 14,
    },
    brand: {
      color: colors.green,
      fontWeight: "800",
      letterSpacing: 2,
      fontSize: 13,
      marginTop: 20,
    },
    brandRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    headerLogo: { width: 28, height: 28 },
    hero: { paddingVertical: 38, alignItems: "flex-start" },
    appLogo: { width: 112, height: 112, marginBottom: 16 },
    eyebrow: { color: colors.gold, fontWeight: "800", letterSpacing: 2 },
    logo: {
      color: colors.ink,
      fontSize: 42,
      fontWeight: "900",
      letterSpacing: -2,
      marginTop: 8,
    },
    tag: { fontSize: 18, color: colors.muted, marginTop: 8 },
    title: {
      color: colors.ink,
      fontWeight: "800",
      fontSize: 30,
      marginVertical: 14,
    },
    connection: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      backgroundColor: colors.surface,
      padding: 12,
      borderRadius: 12,
    },
    connectionDot: { width: 9, height: 9, borderRadius: 5 },
    connectionText: { color: colors.muted, fontSize: 12, flex: 1 },
    note: {
      color: colors.muted,
      textAlign: "center",
      marginTop: 20,
      lineHeight: 20,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 20,
      padding: 18,
      shadowColor: colors.ink,
      shadowOpacity: 0.06,
      shadowRadius: 14,
      elevation: 2,
      gap: 12,
    },
    cardTitle: { fontSize: 19, fontWeight: "800", color: colors.ink },
    body: { fontSize: 15, color: colors.muted, lineHeight: 22 },
    button: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 14,
      padding: 15,
      alignItems: "center",
      backgroundColor: colors.surface,
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 10,
    },
    primary: { backgroundColor: colors.green, borderColor: colors.green },
    disabled: { opacity: 0.55 },
    buttonCopy: { flex: 1, gap: 3 },
    buttonText: { fontSize: 16, fontWeight: "800", color: colors.green },
    buttonSubtitle: { fontSize: 12, color: colors.muted },
    primaryText: { color: colors.onPrimary },
    primarySubtitle: { color: colors.primarySubtitle },
    segment: {
      flexDirection: "row",
      backgroundColor: colors.mint,
      borderRadius: 12,
      padding: 4,
    },
    segmentButton: {
      flex: 1,
      padding: 11,
      borderRadius: 9,
      alignItems: "center",
    },
    segmentActive: { backgroundColor: colors.surface },
    segmentText: { color: colors.muted, fontWeight: "700" },
    segmentTextActive: { color: colors.green, fontWeight: "800" },
    field: { gap: 6 },
    label: { fontWeight: "700", color: colors.ink, marginTop: 4 },
    input: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      padding: 14,
      fontSize: 16,
      backgroundColor: colors.surface,
    },
    welcome: {
      backgroundColor: colors.panel,
      borderRadius: 20,
      padding: 20,
      gap: 5,
    },
    welcomeSmall: {
      color: colors.gold,
      fontSize: 11,
      letterSpacing: 1.5,
      fontWeight: "800",
    },
    welcomeName: { color: colors.panelText, fontSize: 25, fontWeight: "900" },
    welcomeEmail: { color: colors.panelMuted },
    actionGrid: { flexDirection: "row", gap: 12 },
    menuBar: {
      flexDirection: "row",
      gap: 6,
      padding: 5,
      borderRadius: 14,
      backgroundColor: colors.mint,
    },
    menuButton: {
      flex: 1,
      alignItems: "center",
      paddingVertical: 10,
      borderRadius: 10,
    },
    menuButtonActive: { backgroundColor: colors.surface },
    menuText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
    menuTextActive: { color: colors.green, fontWeight: "900" },
    actionCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 18,
      padding: 18,
      minHeight: 96,
      justifyContent: "space-between",
    },
    actionCardPrimary: { backgroundColor: colors.green },
    actionTitle: { color: colors.ink, fontWeight: "800", fontSize: 17 },
    actionCaption: { color: colors.muted, fontSize: 12 },
    detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    section: {
      fontSize: 16,
      fontWeight: "800",
      color: colors.ink,
      marginTop: 10,
    },
    row: {
      backgroundColor: colors.surface,
      padding: 16,
      borderRadius: 14,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    rowTitle: { fontWeight: "800", color: colors.ink },
    rowMeta: { color: colors.muted, marginTop: 4, maxWidth: 250 },
    rowStatus: {
      color: colors.green,
      fontWeight: "700",
      fontSize: 12,
      textTransform: "capitalize",
    },
    photo: {
      height: 180,
      borderRadius: 16,
      backgroundColor: colors.mint,
      alignItems: "center",
      justifyContent: "center",
      overflow: "hidden",
    },
    preview: { width: "100%", height: "100%" },
    issueImage: {
      width: "100%",
      height: 210,
      borderRadius: 14,
      backgroundColor: colors.mint,
    },
    issueImageButton: { height: 210, borderRadius: 14, backgroundColor: colors.mint, overflow: "hidden", position: "relative" },
    imageOpenHint: { position: "absolute", right: 10, bottom: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: "rgba(23,35,47,0.82)" },
    imageOpenHintText: { color: "#ffffff", fontSize: 12, fontWeight: "800" },
    imageModalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center", padding: 16 },
    imageModalPhoto: { width: "100%", height: "84%" },
    imageModalClose: { position: "absolute", top: 48, right: 18, zIndex: 2, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.18)" },
    imageModalCloseText: { color: "#ffffff", fontWeight: "900" },
    photoText: { color: colors.green, fontSize: 18, fontWeight: "800" },
    photoActions: { flexDirection: "row", gap: 10 },
    photoAction: {
      flex: 1,
      borderRadius: 12,
      backgroundColor: colors.mint,
      padding: 13,
      alignItems: "center",
    },
    photoActionText: { color: colors.green, fontWeight: "800" },
    campusList: { gap: 8 },
    campusListRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 12,
      borderRadius: 14,
      backgroundColor: colors.paper,
      borderWidth: 1,
      borderColor: colors.line,
    },
    campusNumber: {
      width: 38,
      height: 38,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.mint,
    },
    campusNumberText: { color: colors.green, fontWeight: "900" },
    campusListCopy: { flex: 1, gap: 3 },
    campusListTitle: { color: colors.ink, fontWeight: "800" },
    campusListMeta: { color: colors.muted, fontSize: 12 },
    campusChevron: { color: colors.green, fontSize: 26, fontWeight: "400" },
    picker: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: 12,
      overflow: "hidden",
    },
    hint: { fontSize: 13, color: colors.muted, lineHeight: 19 },
    dummyMap: {
      height: 220,
      borderRadius: 16,
      backgroundColor: colors.map,
      overflow: "hidden",
      position: "relative",
    },
    mapRoad: {
      position: "absolute",
      backgroundColor: colors.mapRoad,
      width: 5,
      height: "100%",
    },
    mapPin: {
      position: "absolute",
      width: 24,
      height: 24,
      marginLeft: -12,
      marginTop: -12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.green,
      borderRadius: 14,
      borderWidth: 3,
      borderColor: colors.surface,
    },
    mapPinText: { color: colors.onPrimary, fontSize: 13 },
    adminPin: {
      position: "absolute",
      width: 25,
      height: 25,
      marginLeft: -12,
      marginTop: -12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.blue,
      borderRadius: 14,
      borderWidth: 3,
      borderColor: colors.surface,
    },
    adminPinText: {
      color: colors.onPrimary,
      fontSize: 12,
      fontWeight: "900",
    },
    reportPin: {
      position: "absolute",
      width: 20,
      height: 20,
      marginLeft: -10,
      marginTop: -10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.red,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.surface,
    },
    reportPinText: { color: colors.onPrimary, fontSize: 11 },
    mapOverlay: {
      position: "absolute",
      left: 12,
      right: 12,
      bottom: 12,
      backgroundColor: colors.surface,
      borderRadius: 10,
      padding: 10,
      gap: 3,
    },
    mapOverlayTitle: { color: colors.ink, fontWeight: "800" },
    mapOverlayText: { color: colors.muted, fontSize: 11 },
    mapCaption: { color: colors.muted, fontSize: 13 },
    status: {
      flexDirection: "row",
      gap: 8,
      alignItems: "center",
      backgroundColor: colors.mint,
      padding: 12,
      borderRadius: 10,
    },
    statusDot: { color: colors.green },
    statusText: { color: colors.green, fontWeight: "800" },
    duplicateNotice: {
      backgroundColor: colors.warningSurface,
      borderRadius: 12,
      padding: 12,
      gap: 3,
    },
    duplicateTitle: { color: colors.warningText, fontWeight: "800" },
    stat: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    statLabel: { color: colors.muted },
    statValue: {
      fontWeight: "800",
      color: colors.ink,
      textTransform: "capitalize",
    },
    explain: { color: colors.muted, lineHeight: 20, marginTop: 8 },
    link: {
      color: colors.green,
      textAlign: "center",
      fontWeight: "800",
      paddingVertical: 8,
    },
    adminHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    adminTitle: {
      fontSize: 21,
      fontWeight: "900",
      color: colors.ink,
      marginTop: 3,
    },
    refresh: {
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.mint,
    },
    refreshText: { color: colors.green, fontWeight: "800" },
    adminTabs: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      padding: 5,
      borderRadius: 14,
      backgroundColor: colors.mint,
    },
    adminTab: {
      flexGrow: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: "center",
    },
    adminTabActive: { backgroundColor: colors.surface },
    adminTabText: { color: colors.muted, fontWeight: "700", fontSize: 12 },
    adminTabTextActive: { color: colors.green, fontWeight: "900" },
    adminSectionTabs: { flexDirection: "row", gap: 6, padding: 5, borderRadius: 15, backgroundColor: colors.panel },
    adminSectionTab: { flex: 1, paddingVertical: 12, borderRadius: 11, alignItems: "center" },
    adminSectionTabActive: { backgroundColor: colors.surface },
    adminSectionText: { color: colors.panelMuted, fontWeight: "800", fontSize: 12 },
    adminSectionTextActive: { color: colors.green },
    playbookItem: { flex: 1, minWidth: "46%", padding: 9, borderRadius: 10, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
    playbookLabel: { color: colors.ink, fontWeight: "800", fontSize: 12 },
    playbookGroup: { color: colors.muted, fontSize: 11, marginTop: 3, textTransform: "capitalize" },
    interventionCard: { marginTop: 12, padding: 13, borderRadius: 12, backgroundColor: colors.mint, gap: 6 },
    crewPicker: { marginTop: 12, padding: 13, borderRadius: 12, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, gap: 8 },
    interventionTitle: { color: colors.green, fontWeight: "900", fontSize: 12, textTransform: "uppercase" },
    interventionMain: { color: colors.ink, fontWeight: "800", lineHeight: 20 },
    interventionAction: { color: colors.muted, lineHeight: 19 },
    reviewNotice: { color: colors.warningText, backgroundColor: colors.warningSurface, padding: 11, borderRadius: 10, fontWeight: "700" },
    kpis: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    kpi: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 15,
      minWidth: 120,
      flex: 1,
    },
    kpiValue: { fontSize: 26, fontWeight: "900", color: colors.ink },
    kpiLabel: { color: colors.muted, marginTop: 4 },
    hotspot: {
      backgroundColor: colors.surface,
      borderRadius: 13,
      padding: 14,
      flexDirection: "row",
      justifyContent: "space-between",
    },
    hotspotTitle: { color: colors.ink, fontWeight: "800", flex: 1 },
    hotspotMeta: { color: colors.red, fontWeight: "800" },
    badge: {
      alignSelf: "flex-start",
      backgroundColor: colors.mint,
      color: colors.green,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 20,
      textTransform: "uppercase",
      fontWeight: "700",
    },
  });
}

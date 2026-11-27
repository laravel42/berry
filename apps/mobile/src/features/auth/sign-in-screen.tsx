import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiClientError } from '@/api/client';
import {
  probeServer,
  signInWithPassword,
  signInWithPat,
  verifyTwoFactorAndMintToken,
} from '@/auth/service';
import { BerryMark } from '@/components/berry-mark';
import { Segmented } from '@/components/segmented';
import { AppText } from '@/components/text';
import { defaultServerUrl, normalizeServerUrl } from '@/lib/env';
import { useAuthStore } from '@/store/auth-store';
import { colors, fonts, radii, typeScale } from '@/theme/tokens';

type AuthMode = 'email' | 'token';

export function SignInScreen() {
  const insets = useSafeAreaInsets();
  const storedBaseUrl = useAuthStore((state) => state.baseUrl);
  const notice = useAuthStore((state) => state.notice);
  const clearNotice = useAuthStore((state) => state.clearNotice);
  const completeSignIn = useAuthStore((state) => state.completeSignIn);

  const [mode, setMode] = useState<AuthMode>('email');
  const [serverUrl, setServerUrl] = useState(() => storedBaseUrl || defaultServerUrl());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [twoFactorCookie, setTwoFactorCookie] = useState<string | null>(null);
  const [twoFactorOrigin, setTwoFactorOrigin] = useState<string | null>(null);
  const [pat, setPat] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceLabel = Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web';

  const submitEmail = async () => {
    clearNotice();
    setError(null);
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setSubmitting(true);
    try {
      const config = await probeServer(normalized.url);
      const origin = config.signInOrigin || normalized.url;
      const outcome = await signInWithPassword({
        baseUrl: normalized.url,
        email: email.trim(),
        password,
        deviceLabel,
        origin,
      });
      if (outcome.kind === 'two_factor') {
        setTwoFactorCookie(outcome.sessionCookie);
        setTwoFactorOrigin(origin);
        return;
      }
      await completeSignIn({
        baseUrl: normalized.url,
        token: outcome.token,
        tokenId: outcome.tokenId,
      });
    } catch (caught) {
      setError(caught instanceof ApiClientError || caught instanceof Error ? caught.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitTwoFactor = async () => {
    setError(null);
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized.ok || !twoFactorCookie) {
      setTwoFactorCookie(null);
      return;
    }
    if (!totpCode.trim()) {
      setError('Enter your 6-digit authentication code.');
      return;
    }

    setSubmitting(true);
    try {
      const minted = await verifyTwoFactorAndMintToken({
        baseUrl: normalized.url,
        sessionCookie: twoFactorCookie,
        code: totpCode.trim(),
        deviceLabel,
        origin: twoFactorOrigin,
      });
      await completeSignIn({
        baseUrl: normalized.url,
        token: minted.token,
        tokenId: minted.tokenId,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid verification code.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitPat = async () => {
    clearNotice();
    setError(null);
    const normalized = normalizeServerUrl(serverUrl);
    if (!normalized.ok) {
      setError(normalized.error);
      return;
    }

    setSubmitting(true);
    try {
      const bootstrap = await signInWithPat(normalized.url, pat);
      await completeSignIn({
        baseUrl: normalized.url,
        token: pat.trim(),
        tokenId: null,
        bootstrap,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Invalid personal access token.');
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = () => {
    if (submitting) return;
    if (mode === 'token') {
      void submitPat();
      return;
    }
    if (twoFactorCookie) {
      void submitTwoFactor();
      return;
    }
    void submitEmail();
  };

  const canSubmit =
    !submitting &&
    serverUrl.trim().length > 0 &&
    (mode === 'token'
      ? pat.trim().length > 0
      : twoFactorCookie
        ? totpCode.trim().length >= 6
        : email.trim().length > 0 && password.length > 0);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <BerryMark size={36} />
          <AppText mono variant="h1" weight="semibold">
            Berry
          </AppText>
          <AppText variant="body" tone="ash" style={styles.subtitle}>
            Connect to your Berry workspace
          </AppText>
        </View>

        {notice ? (
          <View style={styles.notice}>
            <AppText variant="body" tone="amber">
              {notice}
            </AppText>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorBox}>
            <AppText variant="body" tone="danger">
              {error}
            </AppText>
          </View>
        ) : null}

        <View style={styles.field}>
          <AppText variant="caption" tone="ash">
            Server URL
          </AppText>
          <TextInput
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="https://berry.example.com"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!submitting}
            style={styles.input}
          />
        </View>

        <Segmented
          items={[
            { id: 'email' as const, label: 'Email & password' },
            { id: 'token' as const, label: 'API key' },
          ]}
          value={mode}
          onChange={(next) => {
            setMode(next);
            setError(null);
            setTwoFactorCookie(null);
          }}
        />

        {mode === 'email' && !twoFactorCookie ? (
          <View style={styles.stack}>
            <View style={styles.field}>
              <AppText variant="caption" tone="ash">
                Email
              </AppText>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@company.com"
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                editable={!submitting}
                style={styles.input}
              />
            </View>
            <View style={styles.field}>
              <View style={styles.labelRow}>
                <AppText variant="caption" tone="ash">
                  Password
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  hitSlop={8}
                  onPress={() => setShowPassword((value) => !value)}>
                  <AppText variant="caption" tone="ash">
                    {showPassword ? 'Hide' : 'Show'}
                  </AppText>
                </Pressable>
              </View>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••••••"
                placeholderTextColor={colors.placeholder}
                secureTextEntry={!showPassword}
                textContentType="password"
                autoComplete="password"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                smartInsertDelete={false}
                editable={!submitting}
                onSubmitEditing={onSubmit}
                style={styles.input}
              />
            </View>
            <AppText variant="caption" tone="slate">
              Sign in with GitHub-only accounts using the API key tab (Settings › API Keys).
            </AppText>
          </View>
        ) : null}

        {mode === 'email' && twoFactorCookie ? (
          <View style={styles.stack}>
            <View style={styles.field}>
              <AppText variant="caption" tone="ash">
                Two-factor code
              </AppText>
              <TextInput
                value={totpCode}
                onChangeText={setTotpCode}
                placeholder="123456"
                placeholderTextColor={colors.placeholder}
                keyboardType="number-pad"
                maxLength={8}
                editable={!submitting}
                onSubmitEditing={onSubmit}
                style={styles.input}
              />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setTwoFactorCookie(null);
                setTotpCode('');
                setError(null);
              }}>
              <AppText variant="caption" tone="ash">
                ← Back to email & password
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {mode === 'token' ? (
          <View style={styles.stack}>
            <View style={styles.field}>
              <AppText variant="caption" tone="ash">
                Personal access token
              </AppText>
              <TextInput
                value={pat}
                onChangeText={setPat}
                placeholder="berry_pat_..."
                placeholderTextColor={colors.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                editable={!submitting}
                onSubmitEditing={onSubmit}
                style={styles.input}
              />
            </View>
            <AppText variant="caption" tone="slate">
              Create one in Berry web under Settings › API Keys. Stored securely in device keychain.
            </AppText>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={onSubmit}
          style={[styles.primary, !canSubmit && styles.disabled]}>
          {submitting ? (
            <ActivityIndicator color={colors.buttonPrimaryInk} />
          ) : (
            <AppText variant="h3" weight="medium" style={styles.primaryText}>
              {twoFactorCookie ? 'Verify code' : 'Sign in'}
            </AppText>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.void },
  body: { padding: 20, gap: 16, flexGrow: 1, justifyContent: 'center' },
  brand: { alignItems: 'center', gap: 8, marginBottom: 8 },
  subtitle: { textAlign: 'center' },
  stack: { gap: 12 },
  field: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  input: {
    minHeight: 46,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hair,
    backgroundColor: colors.field,
    paddingHorizontal: 16,
    color: colors.chalk,
    fontFamily: fonts.regular,
    fontSize: typeScale.body.fontSize,
  },
  notice: {
    padding: 12,
    borderRadius: radii.card,
    backgroundColor: '#1C1811',
    borderWidth: 1,
    borderColor: 'rgba(217,164,65,0.35)',
  },
  errorBox: {
    padding: 12,
    borderRadius: radii.card,
    backgroundColor: '#241616',
    borderWidth: 1,
    borderColor: 'rgba(224,106,88,0.45)',
  },
  primary: {
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.buttonPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  disabled: { opacity: 0.45 },
  primaryText: { color: colors.buttonPrimaryInk },
});

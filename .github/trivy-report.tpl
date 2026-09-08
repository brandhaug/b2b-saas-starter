{{- range . }}
{{- $target := .Target }}
{{- range .Vulnerabilities }}
{{ printf "%s: %s %s %s@%s fixed=%s\n" $target .Severity .VulnerabilityID .PkgName .InstalledVersion .FixedVersion }}
{{- end }}
{{- end }}

Name:           zeta
Version:        %{version}
Release:        1%{?dist}
Summary:        Zeta Coding Agent — AI-powered terminal coding assistant

License:        MIT
URL:            https://github.com/can1357/oh-my-pi
Source0:        zeta-cli-linux-x64

BuildArch:      x86_64
Requires:       glibc >= 2.28

%description
Zeta is an OMP downstream distribution that provides a terminal-based
AI coding agent with multi-provider LLM support, tool calling, and
state management. Includes a built-in Stats Dashboard and Web UI.

%prep
# No build step — binary is pre-compiled

%install
rm -rf %{buildroot}
mkdir -p %{buildroot}/usr/bin
mkdir -p %{buildroot}/usr/share/doc/zeta
mkdir -p %{buildroot}/usr/share/bash-completion/completions
mkdir -p %{buildroot}/usr/share/zsh/site-functions
mkdir -p %{buildroot}/usr/share/fish/vendor_completions.d

install -m 755 %{SOURCE0} %{buildroot}/usr/bin/zeta

%files
/usr/bin/zeta
%doc /usr/share/doc/zeta/LICENSE

%changelog
* %(date "+%a %b %d %Y") Zeta Team - %{version}-1
- Zeta release %{version}
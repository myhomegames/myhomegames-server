<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity
    Name="__IDENTITY_NAME__"
    Publisher="__IDENTITY_PUBLISHER__"
    Version="__VERSION_QUAD__"
    ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>MyHomeGames Server</DisplayName>
    <PublisherDisplayName>__PUBLISHER_DISPLAY_NAME__</PublisherDisplayName>
    <Description>Self-hosted personal game library server for MyHomeGames.</Description>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.22621.0" />
  </Dependencies>
  <Applications>
    <Application
      Id="MyHomeGamesServer"
      Executable="MyHomeGames.exe"
      EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="MyHomeGames Server"
        Description="Self-hosted personal game library server"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png"
        BackgroundColor="#FFD700" />
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>

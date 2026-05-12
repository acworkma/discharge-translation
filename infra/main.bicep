// CAF-aligned baseline infra for Discharge Translation Lab
// Resource group: rg-discharge (eastus2), workload=dt, env=prod, instance=001
targetScope = 'resourceGroup'

@description('Azure region')
param location string = 'eastus2'

@description('Workload short name')
param workload string = 'dt'

@description('Environment short name')
param env string = 'prod'

@description('Instance suffix')
param instance string = '001'

@description('Container image to deploy (e.g. crdtprodeus2001.azurecr.io/discharge-translation:latest)')
param containerImage string = ''

@description('App password (sent to container as APP_PASSWORD)')
@secure()
param appPassword string = 'fr24'

@description('Azure AI Foundry inference endpoint (e.g. https://foundry-acw.services.ai.azure.com/models)')
param foundryEndpoint string = 'https://foundry-acw.services.ai.azure.com/models'

@description('JSON array of available Foundry model deployments for the UI picker')
param foundryModelsJson string = '[{"id":"gpt-5.2","provider":"openai","tier":"flagship"},{"id":"gpt-4.1","provider":"openai","tier":"balanced"},{"id":"gpt-4.1-mini-601090","provider":"openai","tier":"budget","display":"gpt-4.1-mini"},{"id":"Mistral-Large-3","provider":"mistral","tier":"flagship"},{"id":"Llama-3.3-70B-Instruct","provider":"meta","tier":"balanced"},{"id":"DeepSeek-V3.2","provider":"deepseek","tier":"flagship"}]'

var regionShort = 'eus2'
var base = '${workload}-${env}-${regionShort}-${instance}'
var baseNoDash = toLower('${workload}${env}${regionShort}${instance}')

var names = {
  log: 'log-${base}'
  appi: 'appi-${base}'
  cae: 'cae-${base}'
  ca: 'ca-${workload}-web-${env}-${regionShort}-${instance}'
  acr: 'cr${baseNoDash}'
  st: 'st${baseNoDash}'
  kv: 'kv-${base}'
  cogTranslator: 'cog-${workload}-trn-${env}-${regionShort}-${instance}'
  uami: 'id-${base}'
}

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: names.log
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource appi 'Microsoft.Insights/components@2020-02-02' = {
  name: names.appi
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: law.id
  }
}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: names.uami
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: names.acr
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: names.st
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
    allowSharedKeyAccess: false
    encryption: {
      services: {
        blob: { enabled: true }
        file: { enabled: true }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource blobSvc 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
  properties: {
    deleteRetentionPolicy: { enabled: true, days: 7 }
  }
}

resource uploadsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobSvc
  name: 'uploads'
  properties: { publicAccess: 'None' }
}

resource tableSvc 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource uploadsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableSvc
  name: 'uploads'
}

resource runsTable 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = {
  parent: tableSvc
  name: 'runs'
}

resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: names.kv
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

resource translator 'Microsoft.CognitiveServices/accounts@2024-04-01-preview' = {
  name: names.cogTranslator
  location: location
  kind: 'TextTranslation'
  sku: { name: 'S1' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: names.cogTranslator
    publicNetworkAccess: 'Enabled'
    disableLocalAuth: false
  }
}

// Azure AI Foundry is provisioned out-of-band (foundry-acw in rg-foundry). Cross-RG role
// assignments for the UAMI on that account are made by the deploy workflow (az role assignment).

// --- RBAC: grant the workload UAMI access to the data planes -------------
// Built-in role IDs (subscription-scoped GUIDs).
var roleIds = {
  storageBlobDataContributor: 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  cognitiveServicesUser: 'a97b65f3-24c7-4388-baec-2e87135dc908'
  acrPull: '7f951dda-4ed3-4680-a7ca-43fe172d538d'
}

resource raBlob 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, uami.id, roleIds.storageBlobDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageBlobDataContributor)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource raTable 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, uami.id, roleIds.storageTableDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.storageTableDataContributor)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource raTranslator 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: translator
  name: guid(translator.id, uami.id, roleIds.cognitiveServicesUser)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.cognitiveServicesUser)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource raAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, uami.id, roleIds.acrPull)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleIds.acrPull)
    principalId: uami.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource cae 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: names.cae
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource ca 'Microsoft.App/containerApps@2024-03-01' = if (!empty(containerImage)) {
  name: names.ca
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${uami.id}': {} }
  }
  properties: {
    managedEnvironmentId: cae.id
    configuration: {
      ingress: { external: true, targetPort: 3000, transport: 'auto' }
      registries: [
        {
          server: '${acr.name}.azurecr.io'
          identity: uami.id
        }
      ]
      secrets: [
        { name: 'app-password', value: appPassword }
      ]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [
            { name: 'APP_PASSWORD', secretRef: 'app-password' }
            { name: 'AZURE_CLIENT_ID', value: uami.properties.clientId }
            { name: 'AZURE_TRANSLATOR_ENDPOINT', value: 'https://${names.cogTranslator}.cognitiveservices.azure.com' }
            { name: 'AZURE_TRANSLATOR_REGION', value: location }
            { name: 'AZURE_FOUNDRY_ENDPOINT', value: foundryEndpoint }
            { name: 'AZURE_FOUNDRY_MODELS_JSON', value: foundryModelsJson }
            { name: 'AZURE_STORAGE_ACCOUNT', value: storage.name }
            { name: 'AZURE_STORAGE_UPLOADS_CONTAINER', value: uploadsContainer.name }
            { name: 'AZURE_STORAGE_UPLOADS_TABLE', value: uploadsTable.name }
            { name: 'AZURE_STORAGE_RUNS_TABLE', value: runsTable.name }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appi.properties.ConnectionString }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

output containerAppFqdn string = !empty(containerImage) ? ca.properties.configuration.ingress.fqdn : ''
output acrLoginServer string = '${acr.name}.azurecr.io'
output uamiPrincipalId string = uami.properties.principalId
output uamiClientId string = uami.properties.clientId

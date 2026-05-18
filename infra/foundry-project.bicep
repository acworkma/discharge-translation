// Cross-RG module: declares the prj-discharge Foundry project under the
// existing foundry-acw Foundry account (provisioned out-of-band in rg-foundry)
// and grants the workload UAMI the Azure AI User data-plane role on it.
//
// Scope: rg-foundry (cross-RG from rg-discharge). Invoked from main.bicep
// with `scope: resourceGroup('rg-foundry')`.
//
// Phase 1 of feat/foundry-demo. Idempotent: re-declaring the project with the
// same name is a no-op once it exists.

targetScope = 'resourceGroup'

@description('Foundry account name (existing, in this RG)')
param foundryAccountName string = 'foundry-acw'

@description('Project location. Must match the account location (eastus2).')
param location string = 'eastus2'

@description('Project name to create under the account')
param projectName string = 'prj-discharge'

@description('Display name shown in the Foundry portal')
param projectDisplayName string = 'Discharge Translation Demo'

@description('Project description')
param projectDescription string = 'HoK Foundry demo: per-LLM prompt agents, CTQS evaluators, consensus orchestrator. Branch: feat/foundry-demo.'

@description('Workload UAMI principalId from the discharge resource group — granted Azure AI User on the project')
param workloadUamiPrincipalId string

resource account 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' existing = {
  name: foundryAccountName
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-04-01-preview' = {
  parent: account
  name: projectName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    displayName: projectDisplayName
    description: projectDescription
  }
}

// Azure AI User — data-plane role for inference + agents on a Foundry project.
// (Foundry portal renders this as "Foundry User".)
var azureAiUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

resource raWorkloadAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: project
  name: guid(project.id, workloadUamiPrincipalId, azureAiUserRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureAiUserRoleId)
    principalId: workloadUamiPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output projectEndpoint string = project.properties.endpoints['AI Foundry API']
output projectResourceId string = project.id
output projectPrincipalId string = project.identity.principalId

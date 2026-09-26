# @file      infra/ibm-cloud/bootstrap.ps1
# @phase     P6
# @owner     Orchestration & Cloud
# @purpose   Idempotent IBM Cloud bootstrap: target region/resource group, install the Code Engine plugin,
#            ensure the Code Engine project exists and is selected. Safe to run repeatedly.
# @usage     pwsh infra/ibm-cloud/bootstrap.ps1  (after `ibmcloud login --sso` or `ibmcloud login --apikey ...`)
# @agentNotes HUMAN runs this. Agents must not execute cloud-mutating commands.
param(
  [string]$Project = "bobops-demo",
  [string]$Region = "us-south",
  [string]$ResourceGroup = "Default"
)

ibmcloud target -r $Region -g $ResourceGroup
ibmcloud plugin install code-engine -f

ibmcloud ce project get --name $Project *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating Code Engine project $Project ..."
  ibmcloud ce project create --name $Project
} else {
  Write-Host "Code Engine project $Project already exists"
}
ibmcloud ce project select --name $Project
ibmcloud ce project current

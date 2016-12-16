var v1_org_schema =
{
    "type": "object",
    "properties": {
        "org_id": {
            "type": "string"
        },
        "from": {
            "type": "integer"
        },
        "to": {
            "type": "integer"
        },
        "sum": {
            "type": "integer"
        },
        "appUsage": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "space_id": {
                        "type": "string"
                    },
                    "app_id": {
                        "type": "string"
                    },
                    "app_name": {
                        "type": "string"
                    },
                    "app_state": {
                        "type": "string"
                    },
                    "app_instance": {
                        "type": "integer"
                    },
                    "app_memory": {
                        "type": "integer"
                    },
                    "app_usage": {
                        "type": "integer"
                    }
                },
                "required": [
                    "space_id",
                    "app_id",
                    "app_name",
                    "app_state",
                    "app_instance",
                    "app_memory",
                    "app_usage"
                ]
            }
        }
    },
    "required": [
        "org_id",
        "from",
        "to",
        "sum",
        "appUsage"
    ]
}

var v1_org_monthly_schema =
{
    "$schema": "http://json-schema.org/draft-04/schema#",
    "type": "object",
    "properties": {
        "org_id": {
            "type": "string"
        },
        "from_month": {
            "type": "string"
        },
        "to_month": {
            "type": "string"
        },
        "sum": {
            "type": "integer"
        },
        "monthly_usage_arr": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "string"
                    },
                    "sum": {
                        "type": "integer"
                    },
                    "spaces": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "space_id": {
                                    "type": "string"
                                },
                                "sum": {
                                    "type": "number"
                                },
                                "app_usage": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "app_id": {
                                                "type": "string"
                                            },
                                            "app_name": {
                                                "type": "string"
                                            },
                                            "app_instance": {
                                                "type": "integer"
                                            },
                                            "app_memory": {
                                                "type": "integer"
                                            },
                                            "app_usage": {
                                                "type": "number"
                                            }
                                        },
                                        "required": [
                                            "app_id",
                                            "app_name",
                                            "app_instance",
                                            "app_memory",
                                            "app_usage"
                                        ]
                                    }
                                }
                            },
                            "required": [
                                "space_id",
                                "sum",
                                "app_usage"
                            ]
                        }
                    }
                },
                "required": [
                    "month",
                    "sum",
                    "spaces"
                ]
            }
        }
    },
    "required": [
        "org_id",
        "from_month",
        "to_month",
        "sum",
        "monthly_usage_arr"
    ]
}

var v1_app_monthly_schema =
{
    "type": "object",
    "properties": {
        "org_id": {
            "type": "string"
        },
        "space_id": {
            "type": "string"
        },
        "app_id": {
            "type": "string"
        },
        "app_name": {
            "type": "string"
        },
        "from_month": {
            "type": "string"
        },
        "to_month": {
            "type": "string"
        },
        "sum": {
            "type": "integer"
        },
        "monthlyUsage": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "string"
                    },
                    "app_instance": {
                        "type": "integer"
                    },
                    "app_memory": {
                        "type": "integer"
                    },
                    "appUsage": {
                        "type": "number"
                    }
                },
                "required": [
                    "month",
                    "app_instance",
                    "app_memory",
                    "appUsage"
                ]
            }
        }
    },
    "required": [
        "org_id",
        "space_id",
        "app_id",
        "app_name",
        "from_month",
        "to_month",
        "sum",
        "monthlyUsage"
    ]
}






var v1_org_body =
{
    "org_id": "e655c52a-6ee5-4cf1-89d4-eac31fb6b36f",
    "from": 1470009600000,
    "to": 1472192759652,
    "sum": 6,
    "app_usage":[
            {
                "space_id": "b5e7f478-6f26-457f-97ce-c57a31afe157",
                "app_id": "657c7e08-34eb-4d69-88a4-61262ce07685",
                "app_name": "spring-crt",
                "app_state": "STARTED",
                "app_instance": 1,
                "app_memory": 512,
                "app_usage": 0.5
            },
            {
                "space_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
                "app_id": "204f83ba-7b3a-4627-9b51-168237fd1695",
                "app_name": "node_demo",
                "app_state": "STARTED",
                "app_instance": 1,
                "app_memory": 512,
                "app_usage": 1
            }
    ]
}

var v1_org_monthly_body =
{
    "org_id": "e655c52a-6ee5-4cf1-89d4-eac31fb6b36f",
    "from_month": "201601",
    "to_month": "201602",
    "sum": 8,
    "monthly_usage_arr":[{
        "month": "201601",
        "sum": 5,
        "spaces": [
            {
                "space_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
                "sum": 2,
                "app_usage_arr": [
                    {
                        "app_id": "204f83ba-7b3a-4627-9b51-168237fd1695",
                        "app_name": "node_demo",
                        "app_instance": 1,
                        "app_memory": 512,
                        "app_usage": 1
                    },
                    {
                        "app_id": "4566f4e8-ec03-4aae-a006-3d6b12ce7a9c",
                        "app_name": "java_demo",
                        "app_instance": 1,
                        "app_memory": 512,
                        "app_usage": 1
                    }
                ]
            },
            {
                "space_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
                "sum": 3,
                "app_usage_arr": [
                    {
                        "app_id": "204f83ba-7b3a-4627-9b51-168237fd1695",
                        "app_name": "node_demo",
                        "app_instance": 1,
                        "app_memory": 512,
                        "app_usage": 1
                    },
                    {
                        "app_id": "4566f4e8-ec03-4aae-a006-3d6b12ce7a9c",
                        "app_name": "java_demo",
                        "app_instance": 1,
                        "app_memory": 512,
                        "app_usage": 2
                    }
                ]
            }
        ]
    },
    {
        "month": "201602",
        "sum": 3,
        "spaces": [
            {
                "space_id": "b5e7f478-6f26-457f-97ce-c57a31afe157",
                "sum": 0.5,
                "app_usage": [
                    {
                        "app_id": "657c7e08-34eb-4d69-88a4-61262ce07685",
                        "app_name": "spring-demo",
                        "app_instance": 1,
                        "app_memory": 512,
                        "app_usage": 0.5
                    }
                ]
            },
            {
                "space_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
                "sum": 2.5,
                "app_usage": [
                    {
                        "app_id": "657c7e08-34eb-4d69-88a4-61262ce07685",
                        "app_name": "spring-crt",
                        "app_instance": 3,
                        "app_memory": 512,
                        "app_usage": 2.5
                    }
                ]
            }
        ]
    }
    ],
    "total_app_usage_arr": [
        {
            "app_id": "657c7e08-34eb-4d69-88a4-61262ce0768",
            "app_name": "spring-demo",
            "app_usage": 223
        },
        {
            "app_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
            "app_name": "spring-crt",
            "app_usage": 234
        },
        {
            "app_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
            "app_name": "node_demo",
            "app_usage": 123
        },
        {
            "app_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
            "app_name": "java_demo",
            "app_usage": 423
        }
    ]
}

var v1_app_monthly_body =
{
    "org_id": "e655c52a-6ee5-4cf1-89d4-eac31fb6b36f",
    "space_id": "7b85dc3f-85f0-40bc-8532-0dabd0bc7bae",
    "app_id": "e655c52a-6ee5-4cf1-89d4-eac31fb6b36f",
    "app_name": "node_demo",
    "from_month": "201601",
    "to_month": "201602",
    "sum": 4,
    "monthly_usage_arr":[
        {
            "month": "201601",
            "app_instance": 1,
            "app_memory": 512,
            "app_usage": 3
        },
        {
            "month": "201602",
            "app_instance": 1,
            "app_memory": 512,
            "app_usage": 1
        }
    ]
}




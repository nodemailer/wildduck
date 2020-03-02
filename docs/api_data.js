define({ "api": [
  {
    "type": "delete",
    "url": "/addresses/forwarded/:address",
    "title": "Delete a forwarded Address",
    "name": "DeleteForwardedAddress",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>ID of the Address</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This address does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/addresses/forwarded/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "delete",
    "url": "/users/:user/addresses/:address",
    "title": "Delete an Address",
    "name": "DeleteUserAddress",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>ID of the Address</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Trying to delete main address. Set a new main address first\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59ef21aef255ed1d9d790e7a/addresses/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "get",
    "url": "/addresses/resolve/:address",
    "title": "Get Address info",
    "name": "GetAddressInfo",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>ID of the Address or e-mail address string</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "allowWildcard",
            "defaultValue": "false",
            "description": "<p>If <code>true</code> then resolves also wildcard addresses</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>E-mail address string</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the user if the address belongs to a User</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "targets",
            "description": "<p>List of forwarding targets if this is a Forwarded address</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits",
            "description": "<p>Account limits and usage for Forwarded address</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.forwards",
            "description": "<p>Forwarding quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.allowed",
            "description": "<p>How many messages per 24 hour can be forwarded</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.used",
            "description": "<p>How many messages are forwarded during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "autoreply",
            "description": "<p>Autoreply information</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "autoreply.status",
            "description": "<p>If true, then autoreply is enabled for this address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.name",
            "description": "<p>Name that is used for the From: header in autoreply message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.subject",
            "description": "<p>Autoreply subject line</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.text",
            "description": "<p>Autoreply plaintext content</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.html",
            "description": "<p>Autoreply HTML content</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "tags",
            "description": "<p>List of tags associated with the Address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring of the time the address was created</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "User-Address:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\",\n  \"address\": \"user@example.com\",\n  \"user\": \"59ef21aef255ed1d9d771bb\"\n  \"created\": \"2017-10-24T11:19:10.911Z\"\n}",
          "type": "json"
        },
        {
          "title": "Forwarded-Address:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\",\n  \"address\": \"user@example.com\",\n  \"targets\": [\n     \"my.other.address@example.com\"\n  ],\n  \"limits\": {\n    \"forwards\": {\n      \"allowed\": 2000,\n      \"used\": 0,\n      \"ttl\": false\n    }\n  },\n  \"autoreply\": {\n     \"status\": false\n  },\n  \"created\": \"2017-10-24T11:19:10.911Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This address does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/addresses/resolve/k%C3%A4ru%40j%C3%B5geva.ee",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "get",
    "url": "/addresses",
    "title": "List registered Addresses",
    "name": "GetAddresses",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query",
            "description": "<p>Partial match of an address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "tags",
            "description": "<p>Comma separated list of tags. The Address must have at least one to be set</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "requiredTags",
            "description": "<p>Comma separated list of tags. The Address must have all listed tags to be set</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Address listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.address",
            "description": "<p>E-mail address string</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.user",
            "description": "<p>User ID this address belongs to if this is a User address</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.forwarded",
            "description": "<p>If true then it is a forwarded address</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": true,
            "field": "results.target",
            "description": "<p>List of forwarding targets</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59ef21aef255ed1d9d790e81\",\n      \"address\": \"user@example.com\",\n      \"user\": \"59ef21aef255ed1d9d790e7a\"\n    },\n    {\n      \"id\": \"59ef21aef255ed1d9d790e81\",\n      \"address\": \"user@example.com\",\n      \"forwarded\": true\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/addresses",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "get",
    "url": "/addresses/forwarded/:address",
    "title": "Request forwarded Addresses information",
    "name": "GetForwardedAddress",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>ID of the Address</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>E-mail address string</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "targets",
            "description": "<p>List of forwarding targets</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits",
            "description": "<p>Account limits and usage</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.forwards",
            "description": "<p>Forwarding quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.allowed",
            "description": "<p>How many messages per 24 hour can be forwarded</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.used",
            "description": "<p>How many messages are forwarded during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "autoreply",
            "description": "<p>Autoreply information</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "autoreply.status",
            "description": "<p>If true, then autoreply is enabled for this address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.name",
            "description": "<p>Name that is used for the From: header in autoreply message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.subject",
            "description": "<p>Autoreply subject line</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.text",
            "description": "<p>Autoreply plaintext content</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "autoreply.html",
            "description": "<p>Autoreply HTML content</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring of the time the address was created</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "results.tags",
            "description": "<p>List of tags associated with the Address</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\",\n  \"address\": \"user@example.com\",\n  \"targets\": [\n     \"my.other.address@example.com\"\n  ],\n  \"limits\": {\n    \"forwards\": {\n      \"allowed\": 2000,\n      \"used\": 0,\n      \"ttl\": false\n    }\n  },\n  \"created\": \"2017-10-24T11:19:10.911Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This address does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/addresses/forwarded/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "get",
    "url": "/users/:user/addresses/:address",
    "title": "Request Addresses information",
    "name": "GetUserAddress",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>ID of the Address</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>E-mail address string</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "main",
            "description": "<p>Indicates if this is the default address for the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring of the time the address was created</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\",\n  \"address\": \"user@example.com\",\n  \"main\": true,\n  \"created\": \"2017-10-24T11:19:10.911Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59ef21aef255ed1d9d790e7a/addresses/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "get",
    "url": "/users/:user/addresses",
    "title": "List registered Addresses for a User",
    "name": "GetUserAddresses",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Address listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.address",
            "description": "<p>E-mail address string</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.main",
            "description": "<p>Indicates if this is the default address for the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.created",
            "description": "<p>Datestring of the time the address was created</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "results.tags",
            "description": "<p>List of tags associated with the Address</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59ef21aef255ed1d9d790e81\",\n      \"address\": \"user@example.com\",\n      \"main\": true,\n      \"created\": \"2017-10-24T11:19:10.911Z\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59ef21aef255ed1d9d790e7a/addresses",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "post",
    "url": "/addresses/forwarded",
    "title": "Create new forwarded Address",
    "name": "PostForwardedAddress",
    "group": "Addresses",
    "description": "<p>Add a new forwarded email address. Addresses can contain unicode characters. Dots in usernames are normalized so no need to create both &quot;firstlast@example.com&quot; and &quot;first.last@example.com&quot;</p> <p>Special addresses <code>*@example.com</code> and <code>username@*</code> catches all emails to these domains or users without a registered destination (requires <code>allowWildcard</code> argument)</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>E-mail Address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "targets",
            "description": "<p>An array of forwarding targets. The value could either be an email address or a relay url to next MX server (&quot;smtp://mx2.zone.eu:25&quot;) or an URL where mail contents are POSTed to</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "forwards",
            "description": "<p>Daily allowed forwarding count for this address</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "allowWildcard",
            "defaultValue": "false",
            "description": "<p>If <code>true</code> then address value can be in the form of <code>*@example.com</code>, otherwise using * is not allowed</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "tags",
            "description": "<p>A list of tags associated with this address</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "autoreply",
            "description": "<p>Autoreply information</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "autoreply.status",
            "description": "<p>If true, then autoreply is enabled for this address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.start",
            "description": "<p>Either a date string or boolean false to disable start time checks</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.end",
            "description": "<p>Either a date string or boolean false to disable end time checks</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.name",
            "description": "<p>Name that is used for the From: header in autoreply message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.subject",
            "description": "<p>Autoreply subject line</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.text",
            "description": "<p>Autoreply plaintext content</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.html",
            "description": "<p>Autoreply HTML content</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This email address already exists\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/addresses/forwarded \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"address\": \"my.new.address@example.com\",\n  \"targets\": [\n      \"my.old.address@example.com\",\n      \"smtp://mx2.zone.eu:25\"\n  ],\n  \"forwards\": 500\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "post",
    "url": "/users/:user/addresses",
    "title": "Create new Address",
    "name": "PostUserAddress",
    "group": "Addresses",
    "description": "<p>Add a new email address for a User. Addresses can contain unicode characters. Dots in usernames are normalized so no need to create both &quot;firstlast@example.com&quot; and &quot;first.last@example.com&quot;</p> <p>Special addresses <code>*@example.com</code>, <code>*suffix@example.com</code> and <code>username@*</code> catches all emails to these domains or users without a registered destination (requires <code>allowWildcard</code> argument)</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>E-mail Address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "tags",
            "description": "<p>A list of tags associated with this address</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "main",
            "defaultValue": "false",
            "description": "<p>Indicates if this is the default address for the User</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "allowWildcard",
            "defaultValue": "false",
            "description": "<p>If <code>true</code> then address value can be in the form of <code>*@example.com</code>, <code>*suffix@example.com</code> and <code>username@*</code>, otherwise using * is not allowed. Static suffix can be up to 32 characters long.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/addresses \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"address\": \"my.new.address@example.com\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "put",
    "url": "/addresses/forwarded/:address",
    "title": "Update forwarded Address information",
    "name": "PutForwardedAddress",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "address",
            "description": "<p>New address. Only affects normal addresses, special addresses that include * can not be changed</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "targets",
            "description": "<p>An array of forwarding targets. The value could either be an email address or a relay url to next MX server (&quot;smtp://mx2.zone.eu:25&quot;) or an URL where mail contents are POSTed to. If set then overwrites previous targets array</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "forwards",
            "description": "<p>Daily allowed forwarding count for this address</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "tags",
            "description": "<p>A list of tags associated with this address</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "autoreply",
            "description": "<p>Autoreply information</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "autoreply.status",
            "description": "<p>If true, then autoreply is enabled for this address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.start",
            "description": "<p>Either a date string or boolean false to disable start time checks</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.end",
            "description": "<p>Either a date string or boolean false to disable end time checks</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.name",
            "description": "<p>Name that is used for the From: header in autoreply message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.subject",
            "description": "<p>Autoreply subject line</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.text",
            "description": "<p>Autoreply plaintext content</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "autoreply.html",
            "description": "<p>Autoreply HTML content</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This address does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/addresses/forwarded/5a1d4541153888cdcd62a71b \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"targets\": [\n    \"some.other.address@example.com\"\n  ]\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "put",
    "url": "/addresses/renameDomain",
    "title": "Rename domain in addresses",
    "name": "PutRenameDomain",
    "group": "Addresses",
    "description": "<p>Renames domain names for addresses, DKIM keys and Domain Aliases</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "oldDomain",
            "description": "<p>Old Domain Name</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "newDomain",
            "description": "<p>New Domain Name</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Failed to rename domain\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/addresses/renameDomain \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"oldDomain\": \"example.com\",\n  \"newDomain\": \"blurdybloop.com\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "put",
    "url": "/users/:user/addresses/:address",
    "title": "Update Address information",
    "name": "PutUserAddress",
    "group": "Addresses",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Identity name</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "address",
            "description": "<p>New address if you want to rename existing address. Only affects normal addresses, special addresses that include * can not be changed</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": false,
            "field": "main",
            "description": "<p>Indicates if this is the default address for the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "tags",
            "description": "<p>A list of tags associated with this address</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/addresses/5a1d4541153888cdcd62a71b \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"main\": true\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/addresses.js",
    "groupTitle": "Addresses"
  },
  {
    "type": "delete",
    "url": "/users/:user/asps/:asp",
    "title": "Delete an Application Password",
    "name": "DeleteASP",
    "group": "ApplicationPasswords",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "asp",
            "description": "<p>ID of the Application Password</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE \"http://localhost:8080/users/59fc66a03e54454869460e45/asps/5a1d6dd776e56b6d97e5dd48\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/asps.js",
    "groupTitle": "ApplicationPasswords"
  },
  {
    "type": "get",
    "url": "/users/:user/asps/:asp",
    "title": "Request ASP information",
    "name": "GetASP",
    "group": "ApplicationPasswords",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "asp",
            "description": "<p>ID of the Application Specific Password</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Application Password</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "description",
            "description": "<p>Description</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "scopes",
            "description": "<p>Allowed scopes for the Application Password</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "lastUse",
            "description": "<p>Information about last use</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "lastUse.time",
            "description": "<p>Datestring of last use or false if password has not been used</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "lastUse.event",
            "description": "<p>Event ID of the security log for the last authentication</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a1d6dd776e56b6d97e5dd48\",\n  \"description\": \"Thunderbird\",\n  \"scopes\": [\n    \"imap\",\n    \"smtp\"\n  ],\n  \"lastUse\": {\n     \"time\": \"2018-06-21T16:51:53.807Z\",\n     \"event\": \"5b2bd7a9d0ba2509deb88f40\"\n  },\n  \"created\": \"2017-11-28T14:08:23.520Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/asps/5a1d6dd776e56b6d97e5dd48\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/asps.js",
    "groupTitle": "ApplicationPasswords"
  },
  {
    "type": "get",
    "url": "/users/:user/asps",
    "title": "List Application Passwords",
    "name": "GetASPs",
    "group": "ApplicationPasswords",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "showAll",
            "defaultValue": "false",
            "description": "<p>If not true then skips entries with a TTL set</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Event listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Application Password</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.description",
            "description": "<p>Description</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "results.scopes",
            "description": "<p>Allowed scopes for the Application Password</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.lastUse",
            "description": "<p>Information about last use</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.lastUse.time",
            "description": "<p>Datestring of last use or false if password has not been used</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.lastUse.event",
            "description": "<p>Event ID of the security log for the last authentication</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.created",
            "description": "<p>Datestring</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"results\": [\n    {\n      \"id\": \"5a1d6dd776e56b6d97e5dd48\",\n      \"description\": \"Thunderbird\",\n      \"scopes\": [\n        \"imap\",\n        \"smtp\"\n      ],\n      \"lastUse\": {\n         \"time\": \"2018-06-21T16:51:53.807Z\",\n         \"event\": \"5b2bd7a9d0ba2509deb88f40\"\n      },\n      \"created\": \"2017-11-28T14:08:23.520Z\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/asps\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/asps.js",
    "groupTitle": "ApplicationPasswords"
  },
  {
    "type": "post",
    "url": "/users/:user/asps",
    "title": "Create new Application Password",
    "name": "PostASP",
    "group": "ApplicationPasswords",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "description",
            "description": "<p>Description</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": false,
            "field": "scopes",
            "description": "<p>List of scopes this Password applies to. Special scope &quot;*&quot; indicates that this password can be used for any scope except &quot;master&quot;</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "generateMobileconfig",
            "description": "<p>If true then result contains a mobileconfig formatted file with account config</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "address",
            "description": "<p>E-mail address to be used as the account address in mobileconfig file. Must be one of the listed identity addresses of the user. Defaults to the main address of the user</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "ttl",
            "description": "<p>TTL in seconds for this password. Every time password is used, TTL is reset to this value</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Application Password</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "password",
            "description": "<p>Application Specific Password. Generated password is whitespace agnostic, so it could be displayed to the client as &quot;abcd efgh ijkl mnop&quot; instead of &quot;abcdefghijklmnop&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "mobileconfig",
            "description": "<p>Base64 encoded mobileconfig file. Generated profile file should be sent to the client with <code>Content-Type</code> value of <code>application/x-apple-aspen-config</code>.</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a1d6dd776e56b6d97e5dd48\",\n  \"password\": \"rflhmllyegblyybd\",\n  \"mobileconfig\": \"MIIQBgYJKoZIhvcNAQcCoIIP9...\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/asps \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"description\": \"Thunderbird\",\n  \"scopes\": [\"imap\", \"smtp\"],\n  \"generateMobileconfig\": true\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/asps.js",
    "groupTitle": "ApplicationPasswords"
  },
  {
    "type": "get",
    "url": "/users/:user/archived/messages",
    "title": "List archived messages",
    "name": "GetArchivedMessages",
    "group": "Archive",
    "description": "<p>Archive contains all recently deleted messages besides Drafts etc.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "order",
            "defaultValue": "desc",
            "description": "<p>Ordering of the records by insert date</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Message listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Message (24 byte hex)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.thread",
            "description": "<p>ID of the Thread</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.from",
            "description": "<p>Sender info</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.from.name",
            "description": "<p>Name of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.from.address",
            "description": "<p>Address of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.to",
            "description": "<p>Recipients in To: field</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.to.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.to.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.cc",
            "description": "<p>Recipients in Cc: field</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.cc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.cc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.bcc",
            "description": "<p>Recipients in Bcc: field. Usually only available for drafts</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.bcc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.bcc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.subject",
            "description": "<p>Message subject</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.date",
            "description": "<p>Datestring</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.intro",
            "description": "<p>First 128 bytes of the message</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.attachments",
            "description": "<p>Does the message have attachments</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.seen",
            "description": "<p>Is this message alread seen or not</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.deleted",
            "description": "<p>Does this message have a \\Deleted flag (should not have as messages are automatically deleted once this flag is set)</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.flagged",
            "description": "<p>Does this message have a \\Flagged flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.contentType",
            "description": "<p>Parsed Content-Type header. Usually needed to identify encrypted messages and such</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.contentType.value",
            "description": "<p>MIME type of the message, eg. &quot;multipart/mixed&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.contentType.params",
            "description": "<p>An object with Content-Type params as key-value pairs</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59fc66a13e54454869460e58\",\n      \"mailbox\": \"59fc66a03e54454869460e46\",\n      \"thread\": \"59fc66a13e54454869460e50\",\n      \"from\": {\n        \"address\": \"rfinnie@domain.dom\",\n        \"name\": \"Ryan Finnie\"\n      },\n      \"subject\": \"Ryan Finnie's MIME Torture Test v1.0\",\n      \"date\": \"2003-10-24T06:28:34.000Z\",\n      \"intro\": \"Welcome to Ryan Finnie's MIME torture test. This message was designed to introduce a couple of the newer features of MIME-aware…\",\n      \"attachments\": true,\n      \"seen\": true,\n      \"deleted\": false,\n      \"flagged\": true,\n      \"draft\": false,\n      \"url\": \"/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1\",\n      \"contentType\": {\n        \"value\": \"multipart/mixed\",\n        \"params\": {\n          \"boundary\": \"=-qYxqvD9rbH0PNeExagh1\"\n        }\n      }\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/archived/messages\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Archive"
  },
  {
    "type": "post",
    "url": "/users/:user/archived/messages/:message/restore",
    "title": "Restore archived Message",
    "name": "RestoreMessage",
    "group": "Archive",
    "description": "<p>Restores a single archived message by moving it back to the mailbox it was deleted from or to provided target mailbox. If target mailbox does not exist, then the message is moved to INBOX.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>Message ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailbox",
            "description": "<p>ID of the target Mailbox. If not set then original mailbox is used.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>Maibox ID the message was moved to</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "id",
            "description": "<p>New ID for the Message</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Restore Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"mailbox\": \"59fc66a13e54454869460e57\",\n  \"id\": 4\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Restore a Message:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/59fc66a03e54454869460e45/archived/messages/59fc66a13e54454869460e58/restore\" \\\n-H 'Content-type: application/json' \\\n-d '{}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Archive"
  },
  {
    "type": "post",
    "url": "/users/:user/archived/restore",
    "title": "Restore archived messages",
    "name": "RestoreMessages",
    "group": "Archive",
    "description": "<p>Initiates a restore task to move archived messages of a date range back to the mailboxes the messages were deleted from. If target mailbox does not exist, then the messages are moved to INBOX.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "start",
            "description": "<p>Datestring</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "end",
            "description": "<p>Datestring</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Restore Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Restore a Message:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/59fc66a03e54454869460e45/archived/restore\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"start\": \"2018-10-01T00:00:00.000Z\",\n  \"end\": \"2018-10-08T23:59:59.999Z\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Archive"
  },
  {
    "type": "get",
    "url": "/audit/:audit",
    "title": "Request Audit Info",
    "name": "GetAudit",
    "group": "Audit",
    "description": "<p>This method returns information about stored audit</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "audit",
            "description": "<p>ID of the Audit</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": true,
            "field": "start",
            "description": "<p>Start time as ISO date</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": true,
            "field": "end",
            "description": "<p>End time as ISO date</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "expires",
            "description": "<p>Expiration date. Audit data is deleted after this date</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a03e54454869460e45\",\n  \"user\": \"59ef21aef255ed1d9d790e7a\",\n  \"start\": \"2018-11-21T14:17:15.833Z\",\n  \"end\": \"2019-11-21T14:17:15.833Z\",\n  \"expires\": \"2020-11-21T14:17:15.833Z\",\n}",
          "type": "text"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Audit not found\",\n  \"code\": \"AuditNotFoundError\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/audit/59fc66a03e54454869460e45/export.mbox\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/audit.js",
    "groupTitle": "Audit"
  },
  {
    "type": "get",
    "url": "/audit/:audit/export.mbox",
    "title": "Export Audited Emails",
    "name": "GetAuditEmails",
    "group": "Audit",
    "description": "<p>This method returns a mailbox file that contains all audited emails</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "audit",
            "description": "<p>ID of the Audit</p>"
          }
        ]
      }
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Audit not found\",\n  \"code\": \"AuditNotFoundError\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/audit/59fc66a03e54454869460e45/export.mbox\"",
        "type": "curl"
      }
    ],
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\nContent-Type: application/octet-stream\n\nFrom ...",
          "type": "text"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "lib/api/audit.js",
    "groupTitle": "Audit"
  },
  {
    "type": "post",
    "url": "/audit",
    "title": "Create new audit",
    "name": "PostAudit",
    "group": "Audit",
    "description": "<p>Initiates a message audit</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "start",
            "description": "<p>Start time as ISO date</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "end",
            "description": "<p>End time as ISO date</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "expires",
            "description": "<p>Expiration date. Audit data is deleted after this date</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID for the created Audit</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a13e54454869460e58\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Failed to process request\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST \"http://localhost:8080/audit\" \\\n-H 'X-Access-Token: 1bece61c4758f02f47d3896bdc425959566b06ac' \\\n-H 'Content-type: application/json' \\\n-d '{\n    \"user\": \"5a1bda70bfbd1442cd96c6f0\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/audit.js",
    "groupTitle": "Audit"
  },
  {
    "type": "delete",
    "url": "/authenticate",
    "title": "Invalidate authentication token",
    "name": "DeleteAuth",
    "group": "Authentication",
    "description": "<p>This method invalidates currently used authentication token. If token is not provided then nothing happens</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          },
          {
            "group": "Error 4xx",
            "optional": true,
            "field": "code",
            "description": "<p>Error code</p>"
          }
        ]
      }
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE \"http://localhost:8080/authenticate\" \\\n-H 'X-Access-Token: 59fc66a03e54454869460e45'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/auth.js",
    "groupTitle": "Authentication"
  },
  {
    "type": "get",
    "url": "/users/:user/authlog",
    "title": "List authentication Events",
    "name": "GetAuthlog",
    "group": "Authentication",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "action",
            "description": "<p>Limit listing only to values with specific action value</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "filterIp",
            "description": "<p>Limit listing only to values with specific IP address</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Event listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Event</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.action",
            "description": "<p>Action identifier</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.result",
            "description": "<p>Did the action succeed</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.sess",
            "description": "<p>Session identifier</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.ip",
            "description": "<p>IP address of the Event</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.created",
            "description": "<p>Datestring of the Event time</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"action\": \"account created\",\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59fc66a03e54454869460e4d\",\n      \"action\": \"account created\",\n      \"result\": \"success\",\n      \"sess\": null,\n      \"ip\": null,\n      \"created\": \"2017-11-03T12:52:48.792Z\",\n      \"expires\": \"2017-12-03T12:52:48.792Z\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/authlog?action=account+created\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/auth.js",
    "groupTitle": "Authentication"
  },
  {
    "type": "get",
    "url": "/users/:user/authlog/:event",
    "title": "Request Event information",
    "name": "GetAuthlogEvent",
    "group": "Authentication",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "event",
            "description": "<p>ID of the Event</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Event</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "action",
            "description": "<p>Action identifier</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "result",
            "description": "<p>Did the action succeed</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "sess",
            "description": "<p>Session identifier</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "ip",
            "description": "<p>IP address of the Event</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring of the Event time</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"id\": \"59fc66a03e54454869460e4d\",\n  \"action\": \"account created\",\n  \"result\": \"success\",\n  \"sess\": null,\n  \"ip\": null,\n  \"created\": \"2017-11-03T12:52:48.792Z\",\n  \"expires\": \"2017-12-03T12:52:48.792Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/authlog/59fc66a03e54454869460e4d\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/auth.js",
    "groupTitle": "Authentication"
  },
  {
    "type": "post",
    "url": "/authenticate",
    "title": "Authenticate a User",
    "name": "PostAuth",
    "group": "Authentication",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "username",
            "description": "<p>Username or E-mail address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "password",
            "description": "<p>Password</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "protocol",
            "description": "<p>Application identifier for security logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "scope",
            "defaultValue": "master",
            "description": "<p>Required scope. One of <code>master</code>, <code>imap</code>, <code>smtp</code>, <code>pop3</code></p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "token",
            "defaultValue": "false",
            "description": "<p>If true then generates a temporary access token that is valid for this user. Only available if scope is &quot;master&quot;. When using user tokens then you can replace user ID in URLs with &quot;me&quot;.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of authenticated User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "username",
            "description": "<p>Username of authenticated User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "scope",
            "description": "<p>The scope this authentication is valid for</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "require2fa",
            "description": "<p>List of enabled 2FA mechanisms</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "requirePasswordChange",
            "description": "<p>Indicates if account hassword has been reset and should be replaced</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": true,
            "field": "token",
            "description": "<p>If access token was requested then this is the value to use as access token when making API requests on behalf of logged in user.</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a12914c350c183bd0d331f0\",\n  \"username\": \"myuser\",\n  \"scope\": \"master\",\n  \"require2fa\": [\n    \"totp\"\n  ],\n  \"requirePasswordChange\": false\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          },
          {
            "group": "Error 4xx",
            "optional": true,
            "field": "code",
            "description": "<p>Error code</p>"
          },
          {
            "group": "Error 4xx",
            "optional": true,
            "field": "id",
            "description": "<p>User ID if the user exists</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Authentication failed. Invalid scope\",\n  \"code\": \"InvalidAuthScope\",\n  \"id\": \"5b22283d45e8d47572eb0381\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/authenticate \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"username\": \"myuser\",\n  \"password\": \"secretpass\",\n  \"scope\": \"master\",\n  \"token\": \"true\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/auth.js",
    "groupTitle": "Authentication"
  },
  {
    "type": "delete",
    "url": "/users/:user/autoreply",
    "title": "Delete Autoreply information",
    "name": "DeleteAutoreply",
    "group": "Autoreplies",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/autoreply",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/autoreply.js",
    "groupTitle": "Autoreplies"
  },
  {
    "type": "get",
    "url": "/users/:user/autoreply",
    "title": "Request Autoreply information",
    "name": "GetAutoreply",
    "group": "Autoreplies",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "status",
            "description": "<p>Is the autoreply enabled (true) or not (false)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Name that is used for the From: header in autoreply message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "subject",
            "description": "<p>Subject line for the autoreply. If empty then uses subject of the original message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "html",
            "description": "<p>HTML formatted content of the autoreply message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "text",
            "description": "<p>Plaintext formatted content of the autoreply message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "start",
            "description": "<p>Datestring of the start of the autoreply</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "end",
            "description": "<p>Datestring of the end of the autoreply</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"status\": true,\n  \"subject\": \"\",\n  \"text\": \"Away from office until Dec.19\",\n  \"html\": \"\",\n  \"start\": \"2017-11-15T00:00:00.000Z\",\n  \"end\": \"2017-12-19T00:00:00.000Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45/autoreply",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/autoreply.js",
    "groupTitle": "Autoreplies"
  },
  {
    "type": "put",
    "url": "/users/:user/autoreply",
    "title": "Update Autoreply information",
    "name": "PutAutoreply",
    "group": "Autoreplies",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "status",
            "description": "<p>Is the autoreply enabled (true) or not (false)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Name that is used for the From: header in autoreply message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "subject",
            "description": "<p>Subject line for the autoreply. If empty then uses subject of the original message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "html",
            "description": "<p>HTML formatted content of the autoreply message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "text",
            "description": "<p>Plaintext formatted content of the autoreply message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "start",
            "description": "<p>Datestring of the start of the autoreply or boolean false to disable start checks</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "end",
            "description": "<p>Datestring of the end of the autoreply or boolean false to disable end checks</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/autoreply \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"status\": true,\n  \"text\": \"Away from office until Dec.19\",\n  \"start\": \"2017-11-15T00:00:00.000Z\",\n  \"end\": \"2017-12-19T00:00:00.000Z\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/autoreply.js",
    "groupTitle": "Autoreplies"
  },
  {
    "type": "delete",
    "url": "/dkim/:dkim",
    "title": "Delete a DKIM key",
    "name": "DeleteDkim",
    "group": "DKIM",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "dkim",
            "description": "<p>ID of the DKIM</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/dkim/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/dkim.js",
    "groupTitle": "DKIM"
  },
  {
    "type": "get",
    "url": "/dkim",
    "title": "List registered DKIM keys",
    "name": "GetDkim",
    "group": "DKIM",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query",
            "description": "<p>Partial match of a Domain name</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Aliases listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the DKIM</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.domain",
            "description": "<p>The domain this DKIM key applies to</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.selector",
            "description": "<p>DKIM selector</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.description",
            "description": "<p>Key description</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.fingerprint",
            "description": "<p>Key fingerprint (SHA1)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.created",
            "description": "<p>Datestring</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59ef21aef255ed1d9d790e81\",\n      \"domain\": \"example.com\",\n      \"selector\": \"oct17\",\n      \"description\": \"Key for marketing emails\",\n      \"fingerprint\": \"6a:aa:d7:ba:e4:99:b4:12:e0:f3:35:01:71:d4:f1:d6:b4:95:c4:f5\",\n      \"created\": \"2017-10-24T11:19:10.911Z\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/dkim",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/dkim.js",
    "groupTitle": "DKIM"
  },
  {
    "type": "get",
    "url": "/dkim/:dkim",
    "title": "Request DKIM information",
    "name": "GetDkimKey",
    "group": "DKIM",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "dkim",
            "description": "<p>ID of the DKIM</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the DKIM</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "domain",
            "description": "<p>The domain this DKIM key applies to</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "selector",
            "description": "<p>DKIM selector</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "description",
            "description": "<p>Key description</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "fingerprint",
            "description": "<p>Key fingerprint (SHA1)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "publicKey",
            "description": "<p>Public key in DNS format (no prefix/suffix, single line)</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "dnsTxt",
            "description": "<p>Value for DNS TXT entry</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "dnsTxt.name",
            "description": "<p>Is the domain name of TXT</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "dnsTxt.value",
            "description": "<p>Is the value of TXT</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e7a\",\n  \"domain\": \"example.com\",\n  \"selector\": \"oct17\",\n  \"description\": \"Key for marketing emails\",\n  \"fingerprint\": \"6a:aa:d7:ba:e4:99:b4:12:e0:f3:35:01:71:d4:f1:d6:b4:95:c4:f5\",\n  \"publicKey\": \"-----BEGIN PUBLIC KEY-----\\r\\nMIGfMA0...\",\n  \"dnsTxt\": {\n    \"name\": \"dec20._domainkey.example.com\",\n    \"value\": \"v=DKIM1;t=s;p=MIGfMA0...\"\n  }\n  \"created\": \"2017-10-24T11:19:10.911Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This Alias does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/dkim/59ef21aef255ed1d9d790e7a",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/dkim.js",
    "groupTitle": "DKIM"
  },
  {
    "type": "post",
    "url": "/dkim",
    "title": "Create or update DKIM key for domain",
    "name": "PostDkim",
    "group": "DKIM",
    "description": "<p>Add a new DKIM key for a Domain or update existing one. There can be single DKIM key registered for each domain name.</p>",
    "header": {
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "domain",
            "description": "<p>Domain name this DKIM key applies to. Use <code>&quot;*&quot;</code> as a special value that will be used for domains that do not have their own DKIM key set</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "selector",
            "description": "<p>Selector for the key</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "description",
            "description": "<p>Key description</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "privateKey",
            "description": "<p>Pem formatted DKIM private key. If not set then a new 2048 bit RSA key is generated, beware though that it can take several seconds to complete.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the DKIM</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "domain",
            "description": "<p>The domain this DKIM key applies to</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "selector",
            "description": "<p>DKIM selector</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "description",
            "description": "<p>Key description</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "fingerprint",
            "description": "<p>Key fingerprint (SHA1)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "publicKey",
            "description": "<p>Public key in DNS format (no prefix/suffix, single line)</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "dnsTxt",
            "description": "<p>Value for DNS TXT entry</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "dnsTxt.name",
            "description": "<p>Is the domain name of TXT</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "dnsTxt.value",
            "description": "<p>Is the value of TXT</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\",\n  \"domain\": \"example.com\",\n  \"selector\": \"oct17\",\n  \"description\": \"Key for marketing emails\",\n  \"fingerprint\": \"6a:aa:d7:ba:e4:99:b4:12:e0:f3:35:01:71:d4:f1:d6:b4:95:c4:f5\",\n  \"publicKey\": \"-----BEGIN PUBLIC KEY-----\\r\\nMIGfMA0...\",\n  \"dnsTxt\": {\n    \"name\": \"dec20._domainkey.example.com\",\n    \"value\": \"v=DKIM1;t=s;p=MIGfMA0...\"\n  }\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/dkim \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"domain\": \"example.com\",\n  \"selector\": \"oct17\",\n  \"description\": \"Key for marketing emails\",\n  \"privateKey\": \"-----BEGIN RSA PRIVATE KEY-----\\r\\n...\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/dkim.js",
    "groupTitle": "DKIM"
  },
  {
    "type": "get",
    "url": "/dkim/resolve/:domain",
    "title": "Resolve ID for a DKIM domain",
    "name": "ResolveDKIM",
    "group": "DKIM",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "domain",
            "description": "<p>DKIM domain</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>DKIM unique ID (24 byte hex)</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This domain does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/dkim/resolve/example.com",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/dkim.js",
    "groupTitle": "DKIM"
  },
  {
    "type": "delete",
    "url": "/domainaliases/:alias",
    "title": "Delete an Alias",
    "name": "DeleteDomainAlias",
    "group": "DomainAliases",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "alias",
            "description": "<p>ID of the Alias</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/domainaliases/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/domainaliases.js",
    "groupTitle": "DomainAliases"
  },
  {
    "type": "get",
    "url": "/domainaliases",
    "title": "List registered Domain Aliases",
    "name": "GetAliases",
    "group": "DomainAliases",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query",
            "description": "<p>Partial match of a Domain Alias or Domain name</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Aliases listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Domain Alias</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.alias",
            "description": "<p>Domain Alias</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.domain",
            "description": "<p>The domain this alias applies to</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59ef21aef255ed1d9d790e81\",\n      \"alias\": \"example.net\",\n      \"domain\": \"example.com\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/domainaliases",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/domainaliases.js",
    "groupTitle": "DomainAliases"
  },
  {
    "type": "get",
    "url": "/domainaliases/:alias",
    "title": "Request Alias information",
    "name": "GetDomainAlias",
    "group": "DomainAliases",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "alias",
            "description": "<p>ID of the Alias</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Alias</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "alias",
            "description": "<p>Alias domain</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "domain",
            "description": "<p>Alias target</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "created",
            "description": "<p>Datestring of the time the alias was created</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e7a\",\n  \"alias\": \"example.net\",\n  \"domain\": \"example.com\",\n  \"created\": \"2017-10-24T11:19:10.911Z\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This Alias does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/domainaliases/59ef21aef255ed1d9d790e7a",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/domainaliases.js",
    "groupTitle": "DomainAliases"
  },
  {
    "type": "post",
    "url": "/domainaliases",
    "title": "Create new Domain Alias",
    "name": "PostDomainAlias",
    "group": "DomainAliases",
    "description": "<p>Add a new Alias for a Domain. This allows to accept mail on username@domain and username@alias</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "alias",
            "description": "<p>Domain Alias</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "domain",
            "description": "<p>Domain name this Alias applies to</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Domain Alias</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59ef21aef255ed1d9d790e81\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/domainaliases \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"domain\": \"example.com\",\n  \"alias\": \"example.org\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/domainaliases.js",
    "groupTitle": "DomainAliases"
  },
  {
    "type": "get",
    "url": "/domainaliases/resolve/:alias",
    "title": "Resolve ID for a domain aias",
    "name": "ResolveDomainAlias",
    "group": "DomainAliases",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "alias",
            "description": "<p>Alias domain</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Alias unique ID (24 byte hex)</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This alias does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/domainaliases/resolve/example.com",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/domainaliases.js",
    "groupTitle": "DomainAliases"
  },
  {
    "type": "delete",
    "url": "/users/:user/filters/:filter",
    "title": "Delete a Filter",
    "name": "DeleteFilter",
    "group": "Filters",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "filter",
            "description": "<p>Filters unique ID</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This filter does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/filters/5a1c0ee490a34c67e266931c",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/filters.js",
    "groupTitle": "Filters"
  },
  {
    "type": "get",
    "url": "/users/:user/filters/:filter",
    "title": "Request Filter information",
    "name": "GetFilter",
    "group": "Filters",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "filter",
            "description": "<p>Filters unique ID.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID for the Filter</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Name of the Filter</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "query",
            "description": "<p>Rules that a message must match</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "query.from",
            "description": "<p>Partial match for the From: header (case insensitive)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "query.to",
            "description": "<p>Partial match for the To:/Cc: headers (case insensitive)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "query.subject",
            "description": "<p>Partial match for the Subject: header (case insensitive)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "query.listId",
            "description": "<p>Partial match for the List-ID: header (case insensitive)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "query.text",
            "description": "<p>Fulltext search against message text</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "query.ha",
            "description": "<p>Does a message have to have an attachment or not</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "query.size",
            "description": "<p>Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "action",
            "description": "<p>Action to take with a matching message</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "action.seen",
            "description": "<p>If true then mark matching messages as Seen</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "action.flag",
            "description": "<p>If true then mark matching messages as Flagged</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "action.delete",
            "description": "<p>If true then do not store matching messages</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "action.spam",
            "description": "<p>If true then store matching messags to Junk Mail folder</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "action.mailbox",
            "description": "<p>Mailbox ID to store matching messages to</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "action.targets",
            "description": "<p>A list of email addresses / HTTP URLs to forward the message to</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "disabled",
            "description": "<p>If true, then this filter is ignored</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a1c0ee490a34c67e266931c\",\n  \"created\": \"2017-11-27T13:11:00.835Z\",\n  \"query\": {\n    \"from\": \"Mäger\"\n  },\n  \"action\": {\n     \"seen\": true\n  },\n  \"disabled\": false\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This filter does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45/filters/5a1c0ee490a34c67e266931c",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/filters.js",
    "groupTitle": "Filters"
  },
  {
    "type": "get",
    "url": "/users/:user/filters",
    "title": "List Filters for a User",
    "name": "GetFilters",
    "group": "Filters",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Filter description</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>Filter ID</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.name",
            "description": "<p>Name for the filter</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.created",
            "description": "<p>Datestring of the time the filter was created</p>"
          },
          {
            "group": "Success 200",
            "type": "Array[]",
            "optional": false,
            "field": "results.query",
            "description": "<p>A list of query descriptions</p>"
          },
          {
            "group": "Success 200",
            "type": "Array[]",
            "optional": false,
            "field": "results.action",
            "description": "<p>A list of action descriptions</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.disabled",
            "description": "<p>If true, then this filter is ignored</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"results\": [\n    {\n      \"id\": \"5a1c0ee490a34c67e266931c\",\n      \"query\": [\n        [\n          \"from\",\n          \"(Mäger)\"\n        ]\n      ],\n      \"action\": [\n        [\n          \"mark as read\"\n        ]\n      ],\n      \"disabled\": false,\n      \"created\": \"2017-11-27T13:11:00.835Z\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/5a1bda70bfbd1442cd96c6f0/filters",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/filters.js",
    "groupTitle": "Filters"
  },
  {
    "type": "post",
    "url": "/users/:user/filters",
    "title": "Create new Filter",
    "name": "PostFilter",
    "group": "Filters",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Name of the Filter</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": false,
            "field": "query",
            "description": "<p>Rules that a message must match</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.from",
            "description": "<p>Partial match for the From: header (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.to",
            "description": "<p>Partial match for the To:/Cc: headers (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.subject",
            "description": "<p>Partial match for the Subject: header (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.listId",
            "description": "<p>Partial match for the List-ID: header (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.text",
            "description": "<p>Fulltext search against message text</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "query.ha",
            "description": "<p>Does a message have to have an attachment or not</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "query.size",
            "description": "<p>Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": false,
            "field": "action",
            "description": "<p>Action to take with a matching message</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.seen",
            "description": "<p>If true then mark matching messages as Seen</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.flag",
            "description": "<p>If true then mark matching messages as Flagged</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.delete",
            "description": "<p>If true then do not store matching messages</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.spam",
            "description": "<p>If true then store matching messags to Junk Mail folder</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "action.mailbox",
            "description": "<p>Mailbox ID to store matching messages to</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "action.targets",
            "description": "<p>An array of forwarding targets. The value could either be an email address or a relay url to next MX server (&quot;smtp://mx2.zone.eu:25&quot;) or an URL where mail contents are POSTed to</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "disabled",
            "description": "<p>If true then this filter is ignored</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID for the created Filter</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a1c0ee490a34c67e266931c\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Empty filter query\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/5a1bda70bfbd1442cd96c6f0/filters \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"query\": {\n    \"from\": \"Mäger\"\n  },\n  \"action\": {\n    \"seen\": true\n  }\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/filters.js",
    "groupTitle": "Filters"
  },
  {
    "type": "put",
    "url": "/users/:user/filters/:filter",
    "title": "Update Filter information",
    "name": "PutFilter",
    "group": "Filters",
    "description": "<p>This method updates Filter data. To unset a value, use empty strings</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "filter",
            "description": "<p>Filters unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Name of the Filter</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": false,
            "field": "query",
            "description": "<p>Rules that a message must match</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.from",
            "description": "<p>Partial match for the From: header (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.to",
            "description": "<p>Partial match for the To:/Cc: headers (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.subject",
            "description": "<p>Partial match for the Subject: header (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.listId",
            "description": "<p>Partial match for the List-ID: header (case insensitive)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query.text",
            "description": "<p>Fulltext search against message text</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "query.ha",
            "description": "<p>Does a message have to have an attachment or not</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "query.size",
            "description": "<p>Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": false,
            "field": "action",
            "description": "<p>Action to take with a matching message</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.seen",
            "description": "<p>If true then mark matching messages as Seen</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.flag",
            "description": "<p>If true then mark matching messages as Flagged</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.delete",
            "description": "<p>If true then do not store matching messages</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "action.spam",
            "description": "<p>If true then store matching messags to Junk Mail folder</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "action.mailbox",
            "description": "<p>Mailbox ID to store matching messages to</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "action.targets",
            "description": "<p>An array of forwarding targets. The value could either be an email address or a relay url to next MX server (&quot;smtp://mx2.zone.eu:25&quot;) or an URL where mail contents are POSTed to</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "disabled",
            "description": "<p>If true then this filter is ignored</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID for the created Filter</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Empty filter query\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/filters/5a1c0ee490a34c67e266931c \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"action\": {\n    \"seen\": \"\",\n    \"flag\": true\n  }\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/filters.js",
    "groupTitle": "Filters"
  },
  {
    "type": "delete",
    "url": "/users/:user/mailboxes/:mailbox",
    "title": "Delete a Mailbox",
    "name": "DeleteMailbox",
    "group": "Mailboxes",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>Mailbox unique ID. Special use folders and INBOX can not be deleted</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Mailbox deletion failed with code CANNOT\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/5a1d2816153888cdcd62a715",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/mailboxes.js",
    "groupTitle": "Mailboxes"
  },
  {
    "type": "get",
    "url": "/users/:user/mailboxes/:mailbox",
    "title": "Request Mailbox information",
    "name": "GetMailbox",
    "group": "Mailboxes",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>Mailbox unique ID</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Mailbox ID</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Name for the mailbox (unicode string)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "path",
            "description": "<p>Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "specialUse",
            "description": "<p>Either special use identifier or <code>null</code>. One of <code>\\Drafts</code>, <code>\\Junk</code>, <code>\\Sent</code> or <code>\\Trash</code></p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "modifyIndex",
            "description": "<p>Modification sequence number. Incremented on every change in the mailbox.</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "subscribed",
            "description": "<p>Mailbox subscription status. IMAP clients may unsubscribe from a folder.</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many messages are stored in this mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "unseen",
            "description": "<p>How many unseen messages are stored in this mailbox</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "    HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a03e54454869460e46\",\n  \"name\": \"INBOX\",\n  \"path\": \"INBOX\",\n  \"specialUse\": null,\n  \"modifyIndex\": 1808,\n  \"subscribed\": true,\n  \"total\": 20,\n  \"unseen\": 2\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This mailbox does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/mailboxes.js",
    "groupTitle": "Mailboxes"
  },
  {
    "type": "get",
    "url": "/users/:user/mailboxes",
    "title": "List Mailboxes for a User",
    "name": "GetMailboxes",
    "group": "Mailboxes",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "specialUse",
            "defaultValue": "false",
            "description": "<p>Should the response include only folders with specialUse flag set.</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "counters",
            "defaultValue": "false",
            "description": "<p>Should the response include counters (total + unseen). Counters come with some overhead.</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "sizes",
            "defaultValue": "false",
            "description": "<p>Should the response include mailbox size in bytes. Size numbers come with a lot of overhead as an aggregated query is ran.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>List of user mailboxes</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>Mailbox ID</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.name",
            "description": "<p>Name for the mailbox (unicode string)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.path",
            "description": "<p>Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.specialUse",
            "description": "<p>Either special use identifier or <code>null</code>. One of <code>\\Drafts</code>, <code>\\Junk</code>, <code>\\Sent</code> or <code>\\Trash</code></p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.modifyIndex",
            "description": "<p>Modification sequence number. Incremented on every change in the mailbox.</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.subscribed",
            "description": "<p>Mailbox subscription status. IMAP clients may unsubscribe from a folder.</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.total",
            "description": "<p>How many messages are stored in this mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.unseen",
            "description": "<p>How many unseen messages are stored in this mailbox</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"results\": [\n    {\n      \"id\": \"59fc66a03e54454869460e46\",\n      \"name\": \"INBOX\",\n      \"path\": \"INBOX\",\n      \"specialUse\": null,\n      \"modifyIndex\": 1808,\n      \"subscribed\": true,\n      \"total\": 20,\n      \"unseen\": 2\n    },\n    {\n      \"id\": \"59fc66a03e54454869460e47\",\n      \"name\": \"Sent Mail\",\n      \"path\": \"Sent Mail\",\n      \"specialUse\": \"\\\\Sent\",\n      \"modifyIndex\": 145,\n      \"subscribed\": true,\n      \"total\": 15,\n      \"unseen\": 0\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes?counters=true",
        "type": "curl"
      },
      {
        "title": "Special Use Only",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes?specialUse=true",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/mailboxes.js",
    "groupTitle": "Mailboxes"
  },
  {
    "type": "post",
    "url": "/users/:user/mailboxes",
    "title": "Create new Mailbox",
    "name": "PostMailboxes",
    "group": "Mailboxes",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "path",
            "description": "<p>Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "retention",
            "defaultValue": "0",
            "description": "<p>Retention policy for the created Mailbox. Milliseconds after a message added to mailbox expires. Set to 0 to disable.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Mailbox ID</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a1d2816153888cdcd62a715\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Mailbox creation failed with code ALREADYEXISTS\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"path\": \"First Level/Second 😎 Level/Folder Name\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/mailboxes.js",
    "groupTitle": "Mailboxes"
  },
  {
    "type": "put",
    "url": "/users/:user/mailboxes/:mailbox",
    "title": "Update Mailbox information",
    "name": "PutMailbox",
    "group": "Mailboxes",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>Mailbox unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "path",
            "description": "<p>Full path of the mailbox, use this to rename an existing Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "retention",
            "description": "<p>Retention policy for the Mailbox. Changing retention value only affects messages added to this folder after the change</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "subscribed",
            "description": "<p>Change Mailbox subscription state</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Mailbox update failed with code ALREADYEXISTS\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/5a1d2816153888cdcd62a715 \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"path\": \"Updated Folder Name\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/mailboxes.js",
    "groupTitle": "Mailboxes"
  },
  {
    "type": "delete",
    "url": "/users/:user/mailboxes/:mailbox/messages/:message",
    "title": "Delete a Message",
    "name": "DeleteMessage",
    "group": "Messages",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>Message ID</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Delete Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Delete a Message:",
        "content": "curl -i -XDELETE \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/2\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "delete",
    "url": "/users/:user/mailboxes/:mailbox/messages",
    "title": "Delete all Messages from a Mailbox",
    "name": "DeleteMessages",
    "group": "Messages",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "deleted",
            "description": "<p>Indicates count of deleted messages</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Delete Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"deleted\": 51\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Delete all Messages:",
        "content": "curl -i -XDELETE \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "post",
    "url": "/users/:user/mailboxes/:mailbox/messages/:message/forward",
    "title": "Forward stored Message",
    "name": "ForwardStoredMessage",
    "group": "Messages",
    "description": "<p>This method allows either to re-forward a message to an original forward target or forward it to some other address. This is useful if a user had forwarding turned on but the message was not delivered so you can try again. Forwarding does not modify the original message.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>Message ID</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "target",
            "description": "<p>Number of original forwarding target</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "addresses",
            "description": "<p>An array of additional forward targets</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "queueId",
            "description": "<p>Message ID in outbound queue</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "forwarded",
            "description": "<p>Information about forwarding targets</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "forwarded.seq",
            "description": "<p>Sequence ID</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "forwarded.type",
            "description": "<p>Target type</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "forwarded.value",
            "description": "<p>Target address</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Forward Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"1600d2f36470008b72\",\n  \"forwarded\": [\n    {\n      \"seq\": \"001\",\n      \"type\": \"mail\",\n      \"value\": \"andris@ethereal.email\"\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Forward a Message:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/1/forward\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"addresses\": [\n    \"andris@ethereal.email\"\n  ]\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "get",
    "url": "/users/:user/mailboxes/:mailbox/messages/:message",
    "title": "Request Message information",
    "name": "GetMessage",
    "group": "Messages",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>ID of the Message</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "markAsSeen",
            "defaultValue": "false",
            "description": "<p>If true then marks message as seen</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "id",
            "description": "<p>ID of the Message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "envelope",
            "description": "<p>SMTP envelope (if available)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "envelope.from",
            "description": "<p>Address from MAIL FROM</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "envelope.rcpt",
            "description": "<p>Array of addresses from RCPT TO (should have just one normally)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "envelope.rcpt.value",
            "description": "<p>RCPT TO address as provided by SMTP client</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "envelope.rcpt.formatted",
            "description": "<p>Normalized RCPT address</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "thread",
            "description": "<p>ID of the Thread</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "from",
            "description": "<p>From: header info</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "from.name",
            "description": "<p>Name of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "from.address",
            "description": "<p>Address of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "to",
            "description": "<p>To: header info</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "to.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "to.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "cc",
            "description": "<p>Cc: header info</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "cc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "cc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "bcc",
            "description": "<p>Recipients in Bcc: field. Usually only available for drafts</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "bcc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "bcc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "subject",
            "description": "<p>Message subject</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "messageId",
            "description": "<p>Message-ID header</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "date",
            "description": "<p>Datestring of message header</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "list",
            "description": "<p>If set then this message is from a mailing list</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "list.id",
            "description": "<p>Value from List-ID header</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "list.unsubscribe",
            "description": "<p>Value from List-Unsubscribe header</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "expires",
            "description": "<p>Datestring, if set then indicates the time after this message is automatically deleted</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "seen",
            "description": "<p>Does this message have a \\Seen flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "deleted",
            "description": "<p>Does this message have a \\Deleted flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "flagged",
            "description": "<p>Does this message have a \\Flagged flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "draft",
            "description": "<p>Does this message have a \\Draft flag</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "html",
            "description": "<p>An array of HTML string. Every array element is from a separate mime node, usually you would just join these to a single string</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "text",
            "description": "<p>Plaintext content of the message</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": true,
            "field": "attachments",
            "description": "<p>List of attachments for this message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "attachments.id",
            "description": "<p>Attachment ID</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "attachments.filename",
            "description": "<p>Filename of the attachment</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "attachments.contentType",
            "description": "<p>MIME type</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "attachments.disposition",
            "description": "<p>Attachment disposition</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "attachments.transferEncoding",
            "description": "<p>Which transfer encoding was used (actual content when fetching attachments is not encoded)</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "attachments.related",
            "description": "<p>Was this attachment found from a multipart/related node. This usually means that this is an embedded image</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "attachments.sizeKb",
            "description": "<p>Approximate size of the attachment in kilobytes</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": true,
            "field": "verificationResults",
            "description": "<p>Security verification info if message was received from MX. If this property is missing then do not automatically assume invalid TLS, SPF or DKIM.</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "verificationResults.tls",
            "description": "<p>TLS information. Value is <code>false</code> if TLS was not used</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "verificationResults.tls.name",
            "description": "<p>Cipher name, eg &quot;ECDHE-RSA-AES128-GCM-SHA256&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "verificationResults.tls.version",
            "description": "<p>TLS version, eg &quot;TLSv1/SSLv3&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "verificationResults.spf",
            "description": "<p>Domain name (either MFROM or HELO) of verified SPF or false if no SPF match was found</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "verificationResults.dkim",
            "description": "<p>Domain name of verified DKIM signature or false if no valid signature was found</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "contentType",
            "description": "<p>Parsed Content-Type header. Usually needed to identify encrypted messages and such</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "contentType.value",
            "description": "<p>MIME type of the message, eg. &quot;multipart/mixed&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "contentType.params",
            "description": "<p>An object with Content-Type params as key-value pairs</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "metaData",
            "description": "<p>Custom metadata object set for this message</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "reference",
            "description": "<p>Referenced message info</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": true,
            "field": "files",
            "description": "<p>List of files added to this message as attachments. Applies to Drafts, normal messages do not have this property. Needed to prevent uploading the same attachment every time a draft is updated</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "files.id",
            "description": "<p>File ID</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "files.filename",
            "description": "<p>Filename of the attached file</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "files.contentType",
            "description": "<p>MIME type</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "files.size",
            "description": "<p>MIME type</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": 1,\n  \"mailbox\": \"59fc66a03e54454869460e46\",\n  \"thread\": \"59fc66a13e54454869460e50\",\n  \"user\": \"59fc66a03e54454869460e45\",\n  \"from\": {\n    \"address\": \"rfinnie@domain.dom\",\n    \"name\": \"Ryan Finnie\"\n  },\n  \"to\": [\n    {\n      \"address\": \"bob@domain.dom\",\n      \"name\": \"\"\n    }\n  ],\n  \"subject\": \"Ryan Finnie's MIME Torture Test v1.0\",\n  \"messageId\": \"<1066976914.4721.5.camel@localhost>\",\n  \"date\": \"2003-10-24T06:28:34.000Z\",\n  \"seen\": true,\n  \"deleted\": false,\n  \"flagged\": true,\n  \"draft\": false,\n  \"html\": [\n    \"<p>Welcome to Ryan Finnie&apos;s MIME torture test.</p>\",\n    \"<p>While a message/rfc822 part inside another message/rfc822 part in a<br/>message isn&apos;t too strange, 200 iterations of that would be.</p>\"\n  ],\n  \"text\": \"Welcome to Ryan Finnie's MIME torture test. This message was designed\\nto introduce a couple of the newer features of MIME-aware MUA\",\n  \"attachments\": [\n    {\n      \"id\": \"ATT00004\",\n      \"filename\": \"foo.gz\",\n      \"contentType\": \"application/x-gzip\",\n      \"disposition\": \"attachment\",\n      \"transferEncoding\": \"base64\",\n      \"related\": false,\n      \"sizeKb\": 1\n    },\n    {\n      \"id\": \"ATT00007\",\n      \"filename\": \"blah1.gz\",\n      \"contentType\": \"application/x-gzip\",\n      \"disposition\": \"attachment\",\n      \"transferEncoding\": \"base64\",\n      \"related\": false,\n      \"sizeKb\": 1\n    }\n  ],\n  \"contentType\": {\n    \"value\": \"multipart/mixed\",\n    \"params\": {\n      \"boundary\": \"=-qYxqvD9rbH0PNeExagh1\"\n    }\n  },\n  \"metaData\": {}\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "get",
    "url": "/users/:user/mailboxes/:mailbox/messages/:message/attachments/:attachment",
    "title": "Download Attachment",
    "name": "GetMessageAttachment",
    "group": "Messages",
    "description": "<p>This method returns attachment file contents in binary form</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>ID of the Message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "attachment",
            "description": "<p>ID of the Attachment</p>"
          }
        ]
      }
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This attachment does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/1/attachments/ATT00002\"",
        "type": "curl"
      }
    ],
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\nContent-Type: image/png\n\n<89>PNG...",
          "type": "text"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "get",
    "url": "/users/:user/mailboxes/:mailbox/messages/:message/message.eml",
    "title": "Get Message source",
    "name": "GetMessageSource",
    "group": "Messages",
    "description": "<p>This method returns the full RFC822 formatted source of the stored message</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>ID of the Message</p>"
          }
        ]
      }
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1/message.eml\"",
        "type": "curl"
      }
    ],
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\nContent-Type: message/rfc822\n\nSubject: Ryan Finnie's MIME Torture Test v1.0\nFrom: Ryan Finnie <rfinnie@domain.dom>\nTo: bob@domain.dom\nContent-Type: multipart/mixed; boundary=\"=-qYxqvD9rbH0PNeExagh1\"\n...",
          "type": "text"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "get",
    "url": "/users/:user/mailboxes/:mailbox/messages",
    "title": "List messages in a Mailbox",
    "name": "GetMessages",
    "group": "Messages",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "unseen",
            "defaultValue": "false",
            "description": "<p>If true, then returns only unseen messages</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "metaData",
            "description": "<p>If true, then includes <code>metaData</code> in the response</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "order",
            "defaultValue": "desc",
            "description": "<p>Ordering of the records by insert date</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Message listing</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.thread",
            "description": "<p>ID of the Thread</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.from",
            "description": "<p>Sender info</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.from.name",
            "description": "<p>Name of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.from.address",
            "description": "<p>Address of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.to",
            "description": "<p>Recipients in To: field</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.to.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.to.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.cc",
            "description": "<p>Recipients in Cc: field</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.cc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.cc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.bcc",
            "description": "<p>Recipients in Bcc: field. Usually only available for drafts</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.bcc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.bcc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.subject",
            "description": "<p>Message subject</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.date",
            "description": "<p>Datestring</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.intro",
            "description": "<p>First 128 bytes of the message</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.attachments",
            "description": "<p>Does the message have attachments</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.seen",
            "description": "<p>Is this message alread seen or not</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.deleted",
            "description": "<p>Does this message have a \\Deleted flag (should not have as messages are automatically deleted once this flag is set)</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.flagged",
            "description": "<p>Does this message have a \\Flagged flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.answered",
            "description": "<p>Does this message have a \\Answered flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.forwarded",
            "description": "<p>Does this message have a $Forwarded flag</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.contentType",
            "description": "<p>Parsed Content-Type header. Usually needed to identify encrypted messages and such</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.contentType.value",
            "description": "<p>MIME type of the message, eg. &quot;multipart/mixed&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.contentType.params",
            "description": "<p>An object with Content-Type params as key-value pairs</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": true,
            "field": "results.metaData",
            "description": "<p>Custom metadata value. Included if <code>metaData</code> query argument was true</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"specialUse\": null,\n  \"results\": [\n    {\n      \"id\": 1,\n      \"mailbox\": \"59fc66a03e54454869460e46\",\n      \"thread\": \"59fc66a13e54454869460e50\",\n      \"from\": {\n        \"address\": \"rfinnie@domain.dom\",\n        \"name\": \"Ryan Finnie\"\n      },\n      \"subject\": \"Ryan Finnie's MIME Torture Test v1.0\",\n      \"date\": \"2003-10-24T06:28:34.000Z\",\n      \"intro\": \"Welcome to Ryan Finnie's MIME torture test. This message was designed to introduce a couple of the newer features of MIME-aware…\",\n      \"attachments\": true,\n      \"seen\": true,\n      \"deleted\": false,\n      \"flagged\": true,\n      \"draft\": false,\n      \"answered\": false,\n      \"forwarded\": false,\n      \"url\": \"/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1\",\n      \"contentType\": {\n        \"value\": \"multipart/mixed\",\n        \"params\": {\n          \"boundary\": \"=-qYxqvD9rbH0PNeExagh1\"\n        }\n      }\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "get",
    "url": "/users/:user/search",
    "title": "Search for messages",
    "name": "GetMessagesSearch",
    "group": "Messages",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "thread",
            "description": "<p>Thread ID</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query",
            "description": "<p>Search string, uses MongoDB fulltext index. Covers data from mesage body and also common headers like from, to, subject etc.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "datestart",
            "description": "<p>Datestring for the earliest message storing time</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "dateend",
            "description": "<p>Datestring for the latest message storing time</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "from",
            "description": "<p>Partial match for the From: header line</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "to",
            "description": "<p>Partial match for the To: and Cc: header lines</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "subject",
            "description": "<p>Partial match for the Subject: header line</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "attachments",
            "description": "<p>If true, then matches only messages with attachments</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "flagged",
            "description": "<p>If true, then matches only messages with \\Flagged flags</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "unseen",
            "description": "<p>If true, then matches only messages without \\Seen flags</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "searchable",
            "description": "<p>If true, then matches messages not in Junk or Trash</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "or",
            "description": "<p>Allows to specify some requests as OR (default is AND). At least one of the values in or block must match</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "or.query",
            "description": "<p>Search string, uses MongoDB fulltext index. Covers data from mesage body and also common headers like from, to, subject etc.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "or.from",
            "description": "<p>Partial match for the From: header line</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "or.to",
            "description": "<p>Partial match for the To: and Cc: header lines</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "or.subject",
            "description": "<p>Partial match for the Subject: header line</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>Message listing</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the Message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.thread",
            "description": "<p>ID of the Thread</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.from",
            "description": "<p>Sender info</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.from.name",
            "description": "<p>Name of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.from.address",
            "description": "<p>Address of the sender</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.to",
            "description": "<p>Recipients in To: field</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.to.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.to.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.cc",
            "description": "<p>Recipients in Cc: field</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.cc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.cc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results.bcc",
            "description": "<p>Recipients in Bcc: field. Usually only available for drafts</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.bcc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.bcc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.subject",
            "description": "<p>Message subject</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.date",
            "description": "<p>Datestring</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.intro",
            "description": "<p>First 128 bytes of the message</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.attachments",
            "description": "<p>Does the message have attachments</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.seen",
            "description": "<p>Is this message alread seen or not</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.deleted",
            "description": "<p>Does this message have a \\Deleted flag (should not have as messages are automatically deleted once this flag is set)</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.flagged",
            "description": "<p>Does this message have a \\Flagged flag</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.url",
            "description": "<p>Relative API url for fetching message contents</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.contentType",
            "description": "<p>Parsed Content-Type header. Usually needed to identify encrypted messages and such</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.contentType.value",
            "description": "<p>MIME type of the message, eg. &quot;multipart/mixed&quot;</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.contentType.params",
            "description": "<p>An object with Content-Type params as key-value pairs</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"query\": \"Ryan\",\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"specialUse\": null,\n  \"results\": [\n    {\n      \"id\": 1,\n      \"mailbox\": \"59fc66a03e54454869460e46\",\n      \"thread\": \"59fc66a13e54454869460e50\",\n      \"from\": {\n        \"address\": \"rfinnie@domain.dom\",\n        \"name\": \"Ryan Finnie\"\n      },\n      \"subject\": \"Ryan Finnie's MIME Torture Test v1.0\",\n      \"date\": \"2003-10-24T06:28:34.000Z\",\n      \"intro\": \"Welcome to Ryan Finnie's MIME torture test. This message was designed to introduce a couple of the newer features of MIME-aware…\",\n      \"attachments\": true,\n      \"seen\": true,\n      \"deleted\": false,\n      \"flagged\": true,\n      \"draft\": false,\n      \"url\": \"/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1\",\n      \"contentType\": {\n        \"value\": \"multipart/mixed\",\n        \"params\": {\n          \"boundary\": \"=-qYxqvD9rbH0PNeExagh1\"\n        }\n      }\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/search?query=Ryan\"",
        "type": "curl"
      },
      {
        "title": "Using OR:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/search?or.from=Ryan&or.to=Ryan\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "put",
    "url": "/users/:user/mailboxes/:mailbox/messages",
    "title": "Update Message information",
    "name": "PutMessage",
    "group": "Messages",
    "description": "<p>This method updates message flags and also allows to move messages to a different mailbox</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "message",
            "description": "<p>Message ID values. Either comma separated numbers (1,2,3) or colon separated range (3:15)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "moveTo",
            "description": "<p>ID of the target Mailbox if you want to move messages</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": false,
            "field": "seen",
            "description": "<p>State of the \\Seen flag</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": false,
            "field": "flagged",
            "description": "<p>State of the \\Flagged flag</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": false,
            "field": "draft",
            "description": "<p>State of the \\Draft flag</p>"
          },
          {
            "group": "Parameter",
            "type": "Datestring",
            "optional": false,
            "field": "expires",
            "description": "<p>Either expiration date or <code>false</code> to turn of autoexpiration</p>"
          },
          {
            "group": "Parameter",
            "type": "Object|String",
            "optional": true,
            "field": "metaData",
            "description": "<p>Optional metadata, must be an object or JSON formatted string of an object</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "id",
            "description": "<p>If messages were moved then lists new ID values. Array entry is an array with first element pointing to old ID and second to new ID</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "updated",
            "description": "<p>If messages were not moved, then indicates the number of updated messages</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Update Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"updated\": 2\n}",
          "type": "json"
        },
        {
          "title": "Move Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"mailbox\": \"59fc66a13e54454869460e57\",\n  \"id\": [\n    [1,24],\n    [2,25]\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Mark messages as unseen:",
        "content": "curl -i -XPUT \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"message\": \"1,2,3\",\n  \"seen\": false\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "post",
    "url": "/users/:user/mailboxes/:mailbox/messages/:message/submit",
    "title": "Submit Draft for delivery",
    "name": "SubmitStoredMessage",
    "group": "Messages",
    "description": "<p>This method allows to submit a draft message for delivery. Draft is moved to Sent mail folder.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "message",
            "description": "<p>Message ID</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": false,
            "field": "deleteFiles",
            "description": "<p>If true then deletes attachment files listed in metaData.files array</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "queueId",
            "description": "<p>Message ID in outbound queue</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": true,
            "field": "message",
            "description": "<p>Information about submitted Message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "message.mailbox",
            "description": "<p>Mailbox ID the draft was moved to (usually Sent mail)</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "message.id",
            "description": "<p>Message ID in Mailbox</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Submit Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"queueId\": \"1682f5a712f000dfb6\",\n  \"message\": {\n    \"id\": 3,\n    \"mailbox\": \"5c279b4e17abae166446f968\"\n  }\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Submit a Message:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/1/submit\" \\\n-H 'Content-type: application/json' \\\n-d '{\n      \"deleteFiles\": true\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "post",
    "url": "/users/:user/mailboxes/:mailbox/messages",
    "title": "Upload Message",
    "name": "UploadMessage",
    "group": "Messages",
    "description": "<p>This method allows to upload either an RFC822 formatted message or a message structure to a mailbox. Raw message is stored unmodified, no headers are added or removed. If you want to generate the uploaded message from strucutred data fields, then do not use the <code>raw</code> property.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "mailbox",
            "description": "<p>ID of the Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "unseen",
            "defaultValue": "false",
            "description": "<p>Is the message unseen or not</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "draft",
            "defaultValue": "false",
            "description": "<p>Is the message a draft or not</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "flagged",
            "defaultValue": "false",
            "description": "<p>Is the message flagged or not</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "raw",
            "description": "<p>base64 encoded message source. Alternatively, you can provide this value as POST body by using message/rfc822 MIME type. If raw message is provided then it overrides any other mail configuration</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "from",
            "description": "<p>Address for the From: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "from.name",
            "description": "<p>Name of the sender</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "from.address",
            "description": "<p>Address of the sender</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "to",
            "description": "<p>Addresses for the To: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "to.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "to.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "cc",
            "description": "<p>Addresses for the Cc: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "cc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "cc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "bcc",
            "description": "<p>Addresses for the Bcc: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "bcc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "bcc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "subject",
            "description": "<p>Message subject. If not then resolved from Reference message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "text",
            "description": "<p>Plaintext message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "html",
            "description": "<p>HTML formatted message</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "headers",
            "description": "<p>Custom headers for the message. If reference message is set then In-Reply-To and References headers are set  automaticall y</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "headers.key",
            "description": "<p>Header key ('X-Mailer')</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "headers.value",
            "description": "<p>Header value ('My Awesome Mailing Service')</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "files",
            "description": "<p>Attachments as storage file IDs. NB! When retrieving message info then an array of objects is returned. When uploading a message then an array of IDs is used.</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "attachments",
            "description": "<p>Attachments for the message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "attachments.content",
            "description": "<p>Base64 encoded attachment content</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "attachments.filename",
            "description": "<p>Attachment filename</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "attachments.contentType",
            "description": "<p>MIME type for the attachment file</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "attachments.cid",
            "description": "<p>Content-ID value if you want to reference to this attachment from HTML formatted message</p>"
          },
          {
            "group": "Parameter",
            "type": "Object|String",
            "optional": true,
            "field": "metaData",
            "description": "<p>Optional metadata, must be an object or JSON formatted string of an object</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "reference",
            "description": "<p>Optional referenced email. If uploaded message is a reply draft and relevant fields are not provided then these are resolved from the message to be replied to</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "reference.mailbox",
            "description": "<p>Mailbox ID</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "reference.id",
            "description": "<p>Message ID in Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "reference.action",
            "description": "<p>Either <code>reply</code>, <code>replyAll</code> or <code>forward</code></p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": false,
            "field": "reference.attachments",
            "defaultValue": "false",
            "description": "<p>If true, then includes all attachments from the original message. If it is an array of attachment ID's includes attachments from the list</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "message",
            "description": "<p>Message information</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "message.id",
            "description": "<p>Message ID in mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "message.mailbox",
            "description": "<p>Mailbox ID the message was stored into</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Forward Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"message\": {\n    \"id\": 2,\n    \"mailbox\": \"5a2f9ca57308fc3a6f5f811e\"\n  }\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Upload a Message:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/5a2f9ca57308fc3a6f5f811d/mailboxes/5a2f9ca57308fc3a6f5f811e/messages\" \\\n-H 'Content-type: message/rfc822' \\\n-d 'From: sender@example.com\nTo: recipient@example.com\nSubject: hello world!\n\nExample message'",
        "type": "curl"
      },
      {
        "title": "Upload a Message Structure:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/5a2f9ca57308fc3a6f5f811d/mailboxes/5a2f9ca57308fc3a6f5f811e/messages\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"from\": {\n    \"name\": \"sender name\",\n    \"address\": \"sender@example.com\"\n  },\n  \"to\": [{\n    \"address\": \"andris@ethereal.email\"\n  }],\n  \"subject\": \"Hello world!\",\n  \"text\": \"Test message\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/messages.js",
    "groupTitle": "Messages"
  },
  {
    "type": "delete",
    "url": "/users/:user/storage/:file",
    "title": "Delete a File",
    "name": "DeleteStorage",
    "group": "Storage",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>ID of the File</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Trying to delete main address. Set a new main address first\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59ef21aef255ed1d9d790e7a/storage/59ef21aef255ed1d9d790e81",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/storage.js",
    "groupTitle": "Storage"
  },
  {
    "type": "get",
    "url": "/users/:user/storage",
    "title": "List stored files",
    "name": "GetStorage",
    "group": "Storage",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query",
            "description": "<p>Partial match of a filename</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>File listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>ID of the File</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.filename",
            "description": "<p>Filename</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.contentType",
            "description": "<p>Content-Type of the file</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.size",
            "description": "<p>File size</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59ef21aef255ed1d9d790e81\",\n      \"filename\": \"hello.txt\",\n      \"size\": 1024\n    },\n    {\n      \"id\": \"59ef21aef255ed1d9d790e82\",\n      \"filename\": \"finances.xls\",\n      \"size\": 2084\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45/storage",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/storage.js",
    "groupTitle": "Storage"
  },
  {
    "type": "get",
    "url": "/users/:user/storage/:file",
    "title": "Download File",
    "name": "GetStorageFile",
    "group": "Storage",
    "description": "<p>This method returns stored file contents in binary form</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "file",
            "description": "<p>ID of the File</p>"
          }
        ]
      }
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This attachment does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i \"http://localhost:8080/users/59fc66a03e54454869460e45/storage/59fc66a13e54454869460e57\"",
        "type": "curl"
      }
    ],
    "success": {
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\nContent-Type: image/png\n\n<89>PNG...",
          "type": "text"
        }
      ]
    },
    "version": "0.0.0",
    "filename": "lib/api/storage.js",
    "groupTitle": "Storage"
  },
  {
    "type": "post",
    "url": "/users/:user/storage",
    "title": "Upload File",
    "name": "UploadStorage",
    "group": "Storage",
    "description": "<p>This method allows to upload an attachment to be linked from a draft</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "Binary",
            "optional": false,
            "field": "content",
            "description": "<p>Request body is the file itself. Make sure to use 'application/binary' as content-type for the request, otherwise the server might try to process the input</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "filename",
            "description": "<p>Filename</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "contentType",
            "description": "<p>MIME type for the file</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "id",
            "description": "<p>File ID</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Forward Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a2f9ca57308fc3a6f5f811e\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Upload a file from disk:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/5c404c9ec1933085b59e7574/storage?filename=00-example.duck.png\" \\\n-H 'Content-type: application/binary' \\\n--data-binary \"@emails/00-example.duck.png\"",
        "type": "curl"
      },
      {
        "title": "Upload a string:",
        "content": "curl -i -XPOST \"http://localhost:8080/users/5c404c9ec1933085b59e7574/storage?filename=hello.txt\" \\\n-H 'Content-type: application/binary' \\\n-d \"Hello world!\"",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/storage.js",
    "groupTitle": "Storage"
  },
  {
    "type": "post",
    "url": "/users/:user/submit",
    "title": "Submit a Message for Delivery",
    "name": "PostSubmit",
    "group": "Submission",
    "description": "<p>Use this method to send emails from a user account</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "reference",
            "description": "<p>Optional referenced email. If submitted message is a reply and relevant fields are not provided then these are resolved from the message to be replied to</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "reference.mailbox",
            "description": "<p>Mailbox ID</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": false,
            "field": "reference.id",
            "description": "<p>Message ID in Mailbox</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "reference.action",
            "description": "<p>Either <code>reply</code>, <code>replyAll</code> or <code>forward</code></p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailbox",
            "description": "<p>Mailbox ID where to upload the message. If not set then message is uploaded to Sent Mail folder.</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "uploadOnly",
            "defaultValue": "false",
            "description": "<p>If <code>true</code> then generated message is not added to the sending queue</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "isDraft",
            "defaultValue": "false",
            "description": "<p>If <code>true</code> then treats this message as draft (should be used with uploadOnly=true)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sendTime",
            "description": "<p>Datestring for delivery if message should be sent some later time</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "envelope",
            "description": "<p>SMTP envelope. If not provided then resolved either from message headers or from referenced message</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "envelope.from",
            "description": "<p>Sender information. If not set then it is resolved to User's default address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "envelope.from.address",
            "description": "<p>Sender address. If this is not listed as allowed address for the sending User then it is replaced with the User's default address</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "envelope.to",
            "description": "<p>Recipients information</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "envelope.to.address",
            "description": "<p>Recipient address</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "from",
            "description": "<p>Address for the From: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "from.name",
            "description": "<p>Name of the sender</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "from.address",
            "description": "<p>Address of the sender</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "to",
            "description": "<p>Addresses for the To: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "to.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "to.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "cc",
            "description": "<p>Addresses for the Cc: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "cc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "cc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "bcc",
            "description": "<p>Addresses for the Bcc: header</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "bcc.name",
            "description": "<p>Name of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "bcc.address",
            "description": "<p>Address of the recipient</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "subject",
            "description": "<p>Message subject. If not then resolved from Reference message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "text",
            "description": "<p>Plaintext message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "html",
            "description": "<p>HTML formatted message</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "headers",
            "description": "<p>Custom headers for the message. If reference message is set then In-Reply-To and References headers are set automatically</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "headers.key",
            "description": "<p>Header key ('X-Mailer')</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "headers.value",
            "description": "<p>Header value ('My Awesome Mailing Service')</p>"
          },
          {
            "group": "Parameter",
            "type": "Object[]",
            "optional": true,
            "field": "attachments",
            "description": "<p>Attachments for the message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "attachments.content",
            "description": "<p>Base64 encoded attachment content</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "attachments.filename",
            "description": "<p>Attachment filename</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "attachments.contentType",
            "description": "<p>MIME type for the attachment file</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "attachments.cid",
            "description": "<p>Content-ID value if you want to reference to this attachment from HTML formatted message</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "meta",
            "description": "<p>Custom metainfo for the message</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "message",
            "description": "<p>Information about submitted Message</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "message.mailbox",
            "description": "<p>Mailbox ID the message was stored to</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "message.id",
            "description": "<p>Message ID in Mailbox</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "message.queueId",
            "description": "<p>Queue ID in MTA</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"message\": {\n    \"id\": 16,\n    \"mailbox\": \"59fc66a03e54454869460e47\",\n    \"queueId\": \"1600798505b000a25f\"\n  }\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "type": "String",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          },
          {
            "group": "Error 4xx",
            "type": "String",
            "optional": false,
            "field": "code",
            "description": "<p>Reason for the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"User account is disabled\",\n  \"code\": \"ERRDISABLEDUSER\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "# Sender info is derived from account settings\ncurl -i -XPOST \"http://localhost:8080/users/59fc66a03e54454869460e45/submit\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"to\": [{\n    \"address\": \"andris@ethereal.email\"\n  }],\n  \"subject\": \"Hello world!\",\n  \"text\": \"Test message\"\n}'",
        "type": "curl"
      },
      {
        "title": "Reply to All",
        "content": "# Recipients and subject line are derived from referenced message\ncurl -i -XPOST \"http://localhost:8080/users/59fc66a03e54454869460e45/submit\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"reference\": {\n    \"mailbox\": \"59fc66a03e54454869460e47\",\n    \"id\": 15,\n    \"action\": \"replyAll\"\n  },\n  \"text\": \"Yeah, sure\"\n}'",
        "type": "curl"
      },
      {
        "title": "Upload only",
        "content": "# Recipients and subject line are derived from referenced message\ncurl -i -XPOST \"http://localhost:8080/users/5a2fe496ce76ede84f177ec3/submit\" \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"reference\": {\n    \"mailbox\": \"5a2fe496ce76ede84f177ec4\",\n    \"id\": 1,\n    \"action\": \"replyAll\"\n  },\n  \"uploadOnly\": true,\n  \"mailbox\": \"5a33b45acf482d3219955bc4\",\n  \"text\": \"Yeah, sure\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/submit.js",
    "groupTitle": "Submission"
  },
  {
    "type": "post",
    "url": "/users/:user/2fa/totp/check",
    "title": "Validate TOTP Token",
    "name": "CheckTotp2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method checks if a TOTP token provided by a User is valid for authentication</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "token",
            "description": "<p>6-digit number</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Failed to validate TOTP\"\n  \"code\": \"InvalidToken\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp/check \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"token\": \"123456\",\n  \"ip\": \"127.0.0.1\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/totp.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "delete",
    "url": "/users/:user/2fa",
    "title": "Disable 2FA",
    "name": "Disable2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method disables all 2FA mechanisms a user might have set up</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username does not exist\"\n  \"code\": \"UserNotFound\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/2fa",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/totp.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "delete",
    "url": "/users/:user/2fa/custom",
    "title": "Disable custom 2FA for a user",
    "name": "DisableCustom2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method disables custom 2FA. If it was the only 2FA set up, then account password for IMAP/POP3/SMTP gets enabled again</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username does not exist\"\n  \"code\": \"UserNotFound\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/2fa/custom \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"ip\": \"127.0.0.1\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/custom.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "delete",
    "url": "/users/:user/2fa/totp",
    "title": "Disable TOTP auth",
    "name": "DisableTotp2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method disables TOTP for a user. Does not affect other 2FA mechanisms a user might have set up</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username does not exist\"\n  \"code\": \"UserNotFound\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/totp.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "put",
    "url": "/users/:user/2fa/custom",
    "title": "Enable custom 2FA for a user",
    "name": "EnableCustom2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method disables account password for IMAP/POP3/SMTP</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username does not exist\"\n  \"code\": \"UserNotFound\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/2fa/custom \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"ip\": \"127.0.0.1\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/custom.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "post",
    "url": "/users/:user/2fa/totp/enable",
    "title": "Enable TOTP seed",
    "name": "EnableTotp2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method enables TOTP for a user by verifying the seed value generated from 2fa/totp/setup</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "token",
            "description": "<p>6-digit number that matches seed value from 2fa/totp/setup</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username does not exist\"\n  \"code\": \"UserNotFound\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp/enable \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"token\": \"123456\",\n  \"ip\": \"127.0.0.1\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/totp.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "post",
    "url": "/users/:user/2fa/totp/setup",
    "title": "Generate TOTP seed",
    "name": "SetupTotp2FA",
    "group": "TwoFactorAuth",
    "description": "<p>This method generates TOTP seed and QR code for 2FA. User needs to verify the seed value using 2fa/totp/enable endpoint</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>ID of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "label",
            "description": "<p>Label text for QR code (defaults to username)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "issuer",
            "description": "<p>Description text for QR code (defaults to &quot;WildDuck&quot;)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "seed",
            "description": "<p>Generated TOTP seed value</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "qrcode",
            "description": "<p>Base64 encoded QR code</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"seed\": \"secretseed\",\n  \"qrcode\": \"base64-encoded-image\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username does not exist\"\n  \"code\": \"UserNotFound\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp/setup \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"label\": \"user@example.com\",\n  \"issuer\": \"My Awesome Web Service\",\n  \"ip\": \"127.0.0.1\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/2fa/totp.js",
    "groupTitle": "TwoFactorAuth"
  },
  {
    "type": "delete",
    "url": "/users/:id",
    "title": "Delete a User",
    "name": "DeleteUser",
    "group": "Users",
    "description": "<p>This method deletes user and address entries from DB and schedules a background task to delete messages. You can call this method several times even if the user has already been deleted, in case there are still some pending messages.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XDELETE http://localhost:8080/users/5a1bda70bfbd1442cd96c6f0?ip=127.0.0.1",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "get",
    "url": "/users/:id/updates",
    "title": "Open change stream",
    "name": "GetUpdates",
    "group": "Users",
    "description": "<p>This api call returns an EventSource response. Listen on this stream to get notifications about changes in messages and mailboxes. Returned events are JSON encoded strings</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "command",
            "description": "<p>Indicates data event type</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\nContent-Type: text/event-stream\n\ndata: {\ndata:   \"command\": \"CREATE\",\ndata:   \"mailbox\": \"5a1d3061153888cdcd62a719\",\ndata:   \"path\": \"First Level/Second 😎 Level/Folder Name\"\ndata: }",
          "type": "text"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "var stream = new EventSource('/users/59fc66a03e54454869460e45/updates');\nstream.onmessage = function(e) {\n  console.log(JSON.parse(e.data));\n};",
        "type": "javascript"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/updates.js",
    "groupTitle": "Users"
  },
  {
    "type": "get",
    "url": "/users/:id",
    "title": "Request User information",
    "name": "GetUser",
    "group": "Users",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID (24 byte hex)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "username",
            "description": "<p>Username of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "name",
            "description": "<p>Name of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "address",
            "description": "<p>Main email address of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "retention",
            "description": "<p>Default retention time in ms. <code>false</code> if not enabled</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "enabled2fa",
            "description": "<p>List of enabled 2FA methods</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "autoreply",
            "description": "<p>Is autoreply enabled or not (start time may still be in the future or end time in the past)</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "encryptMessages",
            "description": "<p>If <code>true</code> then received messages are encrypted</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "encryptForwarded",
            "description": "<p>If <code>true</code> then forwarded messages are encrypted</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "pubKey",
            "description": "<p>Public PGP key for the User that is used for encryption</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "keyInfo",
            "description": "<p>Information about public key or <code>false</code> if key is not available</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "keyInfo.name",
            "description": "<p>Name listed in public key</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "keyInfo.address",
            "description": "<p>E-mail address listed in public key</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "keyInfo.fingerprint",
            "description": "<p>Fingerprint of the public key</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "metaData",
            "description": "<p>Custom metadata object set for this user</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "targets",
            "description": "<p>List of forwarding targets</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "spamLevel",
            "description": "<p>Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits",
            "description": "<p>Account limits and usage</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.quota",
            "description": "<p>Quota usage limits</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.quota.allowed",
            "description": "<p>Allowed quota of the user in bytes</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.quota.used",
            "description": "<p>Space used in bytes</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.recipients",
            "description": "<p>Sending quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.recipients.allowed",
            "description": "<p>How many messages per 24 hours can be sent</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.recipients.used",
            "description": "<p>How many messages are sent during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.recipients.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.forwards",
            "description": "<p>Forwarding quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.allowed",
            "description": "<p>How many messages per 24 hours can be forwarded</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.used",
            "description": "<p>How many messages are forwarded during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.forwards.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.received",
            "description": "<p>Receiving quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.received.allowed",
            "description": "<p>How many messages per 1 hour can be received</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.received.used",
            "description": "<p>How many messages are received during current 1 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.received.ttl",
            "description": "<p>Time until the end of current 1 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.imapUpload",
            "description": "<p>IMAP upload quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapUpload.allowed",
            "description": "<p>How many bytes per 24 hours can be uploaded via IMAP. Only message contents are counted, not protocol overhead.</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapUpload.used",
            "description": "<p>How many bytes are uploaded during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapUpload.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.imapDownload",
            "description": "<p>IMAP download quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapDownload.allowed",
            "description": "<p>How many bytes per 24 hours can be downloaded via IMAP. Only message contents are counted, not protocol overhead.</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapDownload.used",
            "description": "<p>How many bytes are downloaded during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapDownload.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "limits.pop3Download",
            "description": "<p>POP3 download quota</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.pop3Download.allowed",
            "description": "<p>How many bytes per 24 hours can be downloaded via POP3. Only message contents are counted, not protocol overhead.</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.pop3Download.used",
            "description": "<p>How many bytes are downloaded during current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.pop3Download.ttl",
            "description": "<p>Time until the end of current 24 hour period</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapMaxConnections.allowed",
            "description": "<p>How many parallel IMAP connections are permitted</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "limits.imapMaxConnections.used",
            "description": "<p>How many parallel IMAP connections are currenlty in use</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "tags",
            "description": "<p>List of tags associated with the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "disabledScopes",
            "description": "<p>Disabled scopes for this user</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "hasPasswordSet",
            "description": "<p>If <code>true</code> then the User has a password set and can authenticate</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "activated",
            "description": "<p>Is the account activated</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "disabled",
            "description": "<p>If <code>true</code> then the user can not authenticate or receive any new mail</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "suspended",
            "description": "<p>If <code>true</code> then the user can not authenticate</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a03e54454869460e45\",\n  \"username\": \"testuser01\",\n  \"name\": null,\n  \"address\": \"testuser01@example.com\",\n  \"retention\": false,\n  \"enabled2fa\": [],\n  \"autoreply\": false,\n  \"encryptMessages\": false,\n  \"encryptForwarded\": false,\n  \"pubKey\": \"\",\n  \"keyInfo\": false,\n  \"targets\": [\n      \"my.old.address@example.com\",\n      \"smtp://mx2.zone.eu:25\"\n  ],\n  \"limits\": {\n    \"quota\": {\n      \"allowed\": 107374182400,\n      \"used\": 289838\n    },\n    \"recipients\": {\n      \"allowed\": 2000,\n      \"used\": 0,\n      \"ttl\": false\n    },\n    \"forwards\": {\n      \"allowed\": 2000,\n      \"used\": 0,\n      \"ttl\": false\n    }\n  },\n  \"tags\": [\"green\", \"blue\"],\n  \"disabledScopes\": [\"pop3\"],\n  \"hasPasswordSet\": true,\n  \"activated\": true,\n  \"disabled\": false,\n  \"suspended\": false\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/59fc66a03e54454869460e45",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "get",
    "url": "/users/resolve/:username",
    "title": "Resolve ID for a username",
    "name": "GetUsername",
    "group": "Users",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "username",
            "description": "<p>Username of the User. Alphanumeric value. Must start with a letter, dots are allowed but informational only (<em>&quot;user.name&quot;</em> is the same as <em>&quot;username&quot;</em>)</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID (24 byte hex)</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users/resolve/testuser",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "get",
    "url": "/users",
    "title": "List registered Users",
    "name": "GetUsers",
    "group": "Users",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "query",
            "description": "<p>Partial match of username or default email address</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "tags",
            "description": "<p>Comma separated list of tags. The User must have at least one to be set</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "requiredTags",
            "description": "<p>Comma separated list of tags. The User must have all listed tags to be set</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "metaData",
            "description": "<p>If true, then includes <code>metaData</code> in the response</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "limit",
            "defaultValue": "20",
            "description": "<p>How many records to return</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "page",
            "defaultValue": "1",
            "description": "<p>Current page number. Informational only, page numbers start from 1</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "next",
            "description": "<p>Cursor value for next page, retrieved from <code>nextCursor</code> response value</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "previous",
            "description": "<p>Cursor value for previous page, retrieved from <code>previousCursor</code> response value</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "total",
            "description": "<p>How many results were found</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "page",
            "description": "<p>Current page number. Derived from <code>page</code> query argument</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "previousCursor",
            "description": "<p>Either a cursor string or false if there are not any previous results</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "nextCursor",
            "description": "<p>Either a cursor string or false if there are not any next results</p>"
          },
          {
            "group": "Success 200",
            "type": "Object[]",
            "optional": false,
            "field": "results",
            "description": "<p>User listing</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.id",
            "description": "<p>Users unique ID (24 byte hex)</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.username",
            "description": "<p>Username of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.name",
            "description": "<p>Name of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "results.address",
            "description": "<p>Main email address of the User</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "results.tags",
            "description": "<p>List of tags associated with the User'</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "results.targets",
            "description": "<p>List of forwarding targets</p>"
          },
          {
            "group": "Success 200",
            "type": "String[]",
            "optional": false,
            "field": "results.enabled2fa",
            "description": "<p>List of enabled 2FA methods</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.autoreply",
            "description": "<p>Is autoreply enabled or not (start time may still be in the future or end time in the past)</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.encryptMessages",
            "description": "<p>If <code>true</code> then received messages are encrypted</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.encryptForwarded",
            "description": "<p>If <code>true</code> then forwarded messages are encrypted</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": false,
            "field": "results.quota",
            "description": "<p>Quota usage limits</p>"
          },
          {
            "group": "Success 200",
            "type": "Object",
            "optional": true,
            "field": "results.metaData",
            "description": "<p>Custom metadata value. Included if <code>metaData</code> query argument was true</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.quota.allowed",
            "description": "<p>Allowed quota of the user in bytes</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "results.quota.used",
            "description": "<p>Space used in bytes</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.hasPasswordSet",
            "description": "<p>If <code>true</code> then the User has a password set and can authenticate</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.activated",
            "description": "<p>Is the account activated</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.disabled",
            "description": "<p>If <code>true</code> then the user can not authenticate or receive any new mail</p>"
          },
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "results.suspended",
            "description": "<p>If <code>true</code> then the user can not authenticate</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"total\": 1,\n  \"page\": 1,\n  \"previousCursor\": false,\n  \"nextCursor\": false,\n  \"results\": [\n    {\n      \"id\": \"59cb948ad80a820b68f05230\",\n      \"username\": \"myuser\",\n      \"name\": \"John Doe\",\n      \"address\": \"john@example.com\",\n      \"tags\": [],\n      \"forward\": [],\n      \"enabled2a\": [\"totp\"],\n      \"autoreply\": false,\n      \"encryptMessages\": false,\n      \"encryptForwarded\": false,\n      \"quota\": {\n        \"allowed\": 1073741824,\n        \"used\": 17799833\n      },\n      \"hasPasswordSet\": true,\n      \"activated\": true,\n      \"disabled\": false,\n      \"suspended\": false\n    }\n  ]\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Database error\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i http://localhost:8080/users",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "post",
    "url": "/users",
    "title": "Create new user",
    "name": "PostUser",
    "group": "Users",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "username",
            "description": "<p>Username of the User. Dots are allowed but informational only (<em>&quot;user.name&quot;</em> is the same as <em>&quot;username&quot;</em>).</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Name of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "password",
            "description": "<p>Password for the account. Set to boolean <code>false</code> to disable password usage</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "hashedPassword",
            "description": "<p>If <code>true</code> then password is already hashed, so store as. Hash needs to be bcrypt <code>$2a</code>, <code>$2y</code> or <code>$2b</code>. Additionally md5-crypt hashes <code>$1</code> are allowed but these are rehashed on first successful authentication</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "allowUnsafe",
            "defaultValue": "true",
            "description": "<p>If <code>false</code> then validates provided passwords against Have I Been Pwned API. Experimental, so validation is disabled by default but will be enabled automatically in some future version of WildDuck.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "address",
            "description": "<p>Default email address for the User (autogenerated if not set)</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "emptyAddress",
            "description": "<p>If true then do not autogenerate missing email address for the User. Only needed if you want to create a user account that does not have any email address associated</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "requirePasswordChange",
            "description": "<p>If true then requires the user to change password, useful if password for the account was autogenerated</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "tags",
            "description": "<p>A list of tags associated with this user</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "addTagsToAddress",
            "description": "<p>If <code>true</code> then autogenerated address gets the same tags as the user</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "retention",
            "description": "<p>Default retention time in ms. Set to <code>0</code> to disable</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "uploadSentMessages",
            "description": "<p>If <code>true</code> then all messages sent through MSA are also uploaded to the Sent Mail folder. Might cause duplicates with some email clients, so disabled by default.</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "encryptMessages",
            "description": "<p>If <code>true</code> then received messages are encrypted</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "encryptForwarded",
            "description": "<p>If <code>true</code> then forwarded messages are encrypted</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "pubKey",
            "description": "<p>Public PGP key for the User that is used for encryption. Use empty string to remove the key</p>"
          },
          {
            "group": "Parameter",
            "type": "Object|String",
            "optional": true,
            "field": "metaData",
            "description": "<p>Optional metadata, must be an object or JSON formatted string of an object</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "language",
            "description": "<p>Language code for the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "targets",
            "description": "<p>An array of forwarding targets. The value could either be an email address or a relay url to next MX server (&quot;smtp://mx2.zone.eu:25&quot;) or an URL where mail contents are POSTed to</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "spamLevel",
            "defaultValue": "50",
            "description": "<p>Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "quota",
            "description": "<p>Allowed quota of the user in bytes</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "recipients",
            "description": "<p>How many messages per 24 hour can be sent</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "forwards",
            "description": "<p>How many messages per 24 hour can be forwarded</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "imapMaxUpload",
            "description": "<p>How many bytes can be uploaded via IMAP during 24 hour</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "imapMaxDownload",
            "description": "<p>How many bytes can be downloaded via IMAP during 24 hour</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "pop3MaxDownload",
            "description": "<p>How many bytes can be downloaded via POP3 during 24 hour</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "imapMaxConnections",
            "description": "<p>How many parallel IMAP connections are alowed</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "receivedMax",
            "description": "<p>How many messages can be received from MX during 60 seconds</p>"
          },
          {
            "group": "Parameter",
            "type": "Object",
            "optional": true,
            "field": "mailboxes",
            "description": "<p>Optional names for special mailboxes</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailboxes.sent",
            "defaultValue": "Sent Mail",
            "description": "<p>Path of Sent Mail folder</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailboxes.junk",
            "defaultValue": "Junk",
            "description": "<p>Path of spam folder</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailboxes.drafts",
            "defaultValue": "Drafts",
            "description": "<p>Path of drafts folder</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "mailboxes.trash",
            "defaultValue": "Trash",
            "description": "<p>Path of trash folder</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": false,
            "field": "disabledScopes",
            "description": "<p>List of scopes that are disabled for this user (&quot;imap&quot;, &quot;pop3&quot;, &quot;smtp&quot;)</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>ID for the created User</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"id\": \"5a1bda70bfbd1442cd96c6f0\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This username already exists\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"username\": \"myuser\",\n  \"password\": \"verysecret\",\n  \"name\": \"John Doe\",\n  \"address\": \"john.doe@example.com\",\n  \"tags\": [\n    \"status:regular_user\",\n    \"subscription:business_big\"\n  ]\n}'",
        "type": "curl"
      },
      {
        "title": "Example address:",
        "content": "curl -i -XPOST http://localhost:8080/users \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"username\": \"john.doe@example.com\",\n  \"password\": \"verysecret\",\n  \"name\": \"John Doe\",\n  \"tags\": [\n    \"status:regular_user\",\n    \"subscription:business_big\"\n  ]\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "post",
    "url": "/users/:user/quota/reset",
    "title": "Recalculate User quota",
    "name": "PostUserQuota",
    "group": "Users",
    "description": "<p>This method recalculates quota usage for a User. Normally not needed, only use it if quota numbers are way off. This method is not transactional, so if the user is currently receiving new messages then the resulting value is not exact.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "user",
            "description": "<p>Users unique ID.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "Number",
            "optional": false,
            "field": "storageUsed",
            "description": "<p>Calculated quota usage for the user</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"storageUsed\": 1234567\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/quota/reset \\\n-H 'Content-type: application/json' \\\n-d '{}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "post",
    "url": "/quota/reset",
    "title": "Recalculate Quota for all Users",
    "name": "PostUserQuotaAll",
    "group": "Users",
    "description": "<p>This method recalculates quota usage for all Users. Normally not needed, only use it if quota numbers are way off. This method is not transactional, so if the user is currently receiving new messages then the resulting value is not exact.</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"Failed to process request\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/quota/reset \\\n-H 'Content-type: application/json' \\\n-d '{}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "put",
    "url": "/users/:id",
    "title": "Update User information",
    "name": "PutUser",
    "group": "Users",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "name",
            "description": "<p>Name of the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "existingPassword",
            "description": "<p>If provided then validates against account password before applying any changes</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "password",
            "description": "<p>New password for the account. Set to boolean <code>false</code> to disable password usage</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "hashedPassword",
            "description": "<p>If <code>true</code> then password is already hashed, so store as. Hash needs to be bcrypt <code>$2a</code>, <code>$2y</code> or <code>$2b</code>. Additionally md5-crypt hashes <code>$1</code> are allowed but these are rehashed on first successful authentication</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "allowUnsafe",
            "defaultValue": "true",
            "description": "<p>If <code>false</code> then validates provided passwords against Have I Been Pwned API. Experimental, so validation is disabled by default but will be enabled automatically in some future version of WildDuck.</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "tags",
            "description": "<p>A list of tags associated with this user</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "retention",
            "description": "<p>Default retention time in ms. Set to <code>0</code> to disable</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "uploadSentMessages",
            "description": "<p>If <code>true</code> then all messages sent through MSA are also uploaded to the Sent Mail folder. Might cause duplicates with some email clients, so disabled by default.</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "encryptMessages",
            "description": "<p>If <code>true</code> then received messages are encrypted</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "encryptForwarded",
            "description": "<p>If <code>true</code> then forwarded messages are encrypted</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "pubKey",
            "description": "<p>Public PGP key for the User that is used for encryption. Use empty string to remove the key</p>"
          },
          {
            "group": "Parameter",
            "type": "Object|String",
            "optional": true,
            "field": "metaData",
            "description": "<p>Optional metadata, must be an object or JSON formatted string of an object</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "language",
            "description": "<p>Language code for the User</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": true,
            "field": "targets",
            "description": "<p>An array of forwarding targets. The value could either be an email address or a relay url to next MX server (&quot;smtp://mx2.zone.eu:25&quot;) or an URL where mail contents are POSTed to</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "spamLevel",
            "description": "<p>Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "quota",
            "description": "<p>Allowed quota of the user in bytes</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "recipients",
            "description": "<p>How many messages per 24 hour can be sent</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "forwards",
            "description": "<p>How many messages per 24 hour can be forwarded</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "imapMaxUpload",
            "description": "<p>How many bytes can be uploaded via IMAP during 24 hour</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "imapMaxDownload",
            "description": "<p>How many bytes can be downloaded via IMAP during 24 hour</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "pop3MaxDownload",
            "description": "<p>How many bytes can be downloaded via POP3 during 24 hour</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "imapMaxConnections",
            "description": "<p>How many parallel IMAP connections are alowed</p>"
          },
          {
            "group": "Parameter",
            "type": "Number",
            "optional": true,
            "field": "receivedMax",
            "description": "<p>How many messages can be received from MX during 60 seconds</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "disable2fa",
            "description": "<p>If true, then disables 2FA for this user</p>"
          },
          {
            "group": "Parameter",
            "type": "String[]",
            "optional": false,
            "field": "disabledScopes",
            "description": "<p>List of scopes that are disabled for this user (&quot;imap&quot;, &quot;pop3&quot;, &quot;smtp&quot;)</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "disabled",
            "description": "<p>If true then disables user account (can not login, can not receive messages)</p>"
          },
          {
            "group": "Parameter",
            "type": "Boolean",
            "optional": true,
            "field": "suspended",
            "description": "<p>If true then disables authentication</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45 \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"name\": \"Updated user name\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "put",
    "url": "/users/:id/logout",
    "title": "Log out User",
    "name": "PutUserLogout",
    "group": "Users",
    "description": "<p>This method logs out all user sessions in IMAP</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "reason",
            "description": "<p>Message to be shown to connected IMAP client</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/logout \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"reason\": \"Logout requested from API\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  },
  {
    "type": "post",
    "url": "/users/:id/password/reset",
    "title": "Reset password for a User",
    "name": "ResetUserPassword",
    "group": "Users",
    "description": "<p>This method generates a new temporary password for a User. Additionally it removes all two-factor authentication settings</p>",
    "header": {
      "fields": {
        "Header": [
          {
            "group": "Header",
            "type": "String",
            "optional": false,
            "field": "X-Access-Token",
            "description": "<p>Optional access token if authentication is enabled</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Header-Example:",
          "content": "{\n  \"X-Access-Token\": \"59fc66a03e54454869460e45\"\n}",
          "type": "json"
        }
      ]
    },
    "parameter": {
      "fields": {
        "Parameter": [
          {
            "group": "Parameter",
            "type": "String",
            "optional": false,
            "field": "id",
            "description": "<p>Users unique ID.</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "validAfter",
            "description": "<p>Allow using the generated password not earlier than provided time</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "sess",
            "description": "<p>Session identifier for the logs</p>"
          },
          {
            "group": "Parameter",
            "type": "String",
            "optional": true,
            "field": "ip",
            "description": "<p>IP address for the logs</p>"
          }
        ]
      }
    },
    "success": {
      "fields": {
        "Success 200": [
          {
            "group": "Success 200",
            "type": "Boolean",
            "optional": false,
            "field": "success",
            "description": "<p>Indicates successful response</p>"
          },
          {
            "group": "Success 200",
            "type": "String",
            "optional": false,
            "field": "password",
            "description": "<p>Temporary password</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Success-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"success\": true,\n  \"password\": \"temporarypass\"\n}",
          "type": "json"
        }
      ]
    },
    "error": {
      "fields": {
        "Error 4xx": [
          {
            "group": "Error 4xx",
            "optional": false,
            "field": "error",
            "description": "<p>Description of the error</p>"
          }
        ]
      },
      "examples": [
        {
          "title": "Error-Response:",
          "content": "HTTP/1.1 200 OK\n{\n  \"error\": \"This user does not exist\"\n}",
          "type": "json"
        }
      ]
    },
    "examples": [
      {
        "title": "Example usage:",
        "content": "curl -i -XPOST http://localhost:8080/users/5a1bda70bfbd1442cd96/password/reset \\\n-H 'Content-type: application/json' \\\n-d '{\n  \"ip\": \"127.0.0.1\"\n}'",
        "type": "curl"
      }
    ],
    "version": "0.0.0",
    "filename": "lib/api/users.js",
    "groupTitle": "Users"
  }
] });
